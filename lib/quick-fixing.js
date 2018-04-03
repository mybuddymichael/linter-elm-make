'use babel';

import { Range, Point } from 'atom';
import path from 'path';
import fs from 'fs';
import _ from 'underscore-plus';
import helper from './helper';

export default {
  // TODO: Tests.
  getFixesForProblem(
    problem,
    range,
    regionRange,
    subregionRange,
    editor,
    getFunctionsMatchingTypeFunction
  ) {
    if (problem.tag) {
      return getFixesForTaggedProblem(
        problem,
        range,
        regionRange,
        subregionRange,
        editor,
        getFunctionsMatchingTypeFunction
      );
    }
    let matches = null;
    matches = problem.match(
      /^The module name is messed up for (.+)\n\n    According to the file's name it should be (.+)\n    According to the source code it should be (.+)\n\nWhich is it\?$/
    );
    if (matches && matches.length > 2) {
      const editorFilePath = editor.getPath();
      const projectDirectory = helper.lookupElmPackage(
        path.dirname(editorFilePath),
        editorFilePath
      );
      return [
        {
          type: 'Fix module name',
          text: matches[2],
          filePath: path.resolve(projectDirectory, matches[1]),
        },
      ];
    }
    if (problem === 'elm-make: <stdin>: hGetLine: end of file') {
      const directory = path.dirname(editor.getPath());
      return [
        {
          type: 'Run `elm package install`',
          text: 'Directory: ' + directory,
          directory,
        },
      ];
    }
    return null;
  },

  // TODO: Tests.
  // As a workaround for `Intentions` limitation, add a class in `linter-elm-make.less` for each fix type.
  fixProblem(
    editor,
    range,
    fix,
    getFunctionsMatchingTypeFunction,
    showFunctionsMatchingTypeFunction
  ) {
    switch (fix.type) {
      case 'Replace with':
        editor.setTextInBufferRange(fix.range ? fix.range : range, fix.text);
        break;

      case 'Add type annotation':
        // Insert type annotation above the line.
        const leadingSpaces = new Array(range.start.column).join(' ');
        editor.setTextInBufferRange(
          [range.start, range.start],
          fix.text + '\n' + leadingSpaces
        );
        // Remove type annotation marker, if any.
        const markers = editor.findMarkers({
          fixType: 'Add type annotation',
          fixRange: range,
        });
        if (markers) {
          markers.forEach(marker => {
            marker.destroy();
          });
        }
        break;

      case 'Remove unused import':
        editor.buffer.deleteRow(range.start.row);
        break;

      case 'Add import':
        // Insert below the last import, or module declaration (unless already imported (as when using `Quick Fix All`)).
        let alreadyImported = false;
        const allImportsRegex = /((?:^|\n)import\s([\w\.]+)(?:\s+as\s+(\w+))?(?:\s+exposing\s*\(((?:\s*(?:\w+|\(.+\))\s*,)*)\s*((?:\.\.|\w+|\(.+\)))\s*\))?)+/m;
        editor.scanInBufferRange(
          allImportsRegex,
          [[0, 0], editor.getEofBufferPosition()],
          ({ matchText, range, stop }) => {
            if (!new RegExp('^' + fix.text + '$', 'm').test(matchText)) {
              const insertPoint = range.end.traverse([1, 0]);
              editor.setTextInBufferRange(
                [insertPoint, insertPoint],
                fix.text + '\n'
              );
            }
            alreadyImported = true;
            stop();
          }
        );
        if (!alreadyImported) {
          const moduleRegex = /(?:^|\n)((effect|port)\s+)?module\s+([\w\.]+)(?:\s+exposing\s*\(((?:\s*(?:\w+|\(.+\))\s*,)*)\s*((?:\.\.|\w+|\(.+\)))\s*\))?(\s*^{-\|([\s\S]*?)-}\s*|)/m;
          editor.scanInBufferRange(
            moduleRegex,
            [[0, 0], editor.getEofBufferPosition()],
            ({ range, stop }) => {
              const insertPoint = range.end.traverse([1, 0]);
              editor.setTextInBufferRange(
                [insertPoint, insertPoint],
                '\n' + fix.text + '\n'
              );
              alreadyImported = true;
              stop();
            }
          );
        }
        if (!alreadyImported) {
          editor.setTextInBufferRange([[0, 0], [0, 0]], fix.text + '\n');
        }
        break;

      case 'Add missing patterns':
        editor.transact(() => {
          const leadingSpaces =
            new Array(fix.range.start.column + 1).join(' ') +
            helper.tabSpaces();
          editor.setCursorBufferPosition(fix.range.end);
          const patternsString = fix.patterns
            .map(pattern => {
              return (
                '\n\n' +
                leadingSpaces +
                pattern +
                ' ->\n' +
                leadingSpaces +
                helper.tabSpaces() +
                'Debug.crash "TODO"'
              );
            })
            .join('');
          editor.insertText(patternsString);
        });
        break;

      case 'Remove redundant patterns':
        // TODO
        break;

      case 'Fix module name':
        atom.workspace.open(fix.filePath).then(editor => {
          editor.scanInBufferRange(
            /(?:^|\n)((?:(?:effect|port)\s+)?module(?:\s+))(\S+)\s/,
            [[0, 0], editor.getEofBufferPosition()],
            ({ match, range, replace, stop }) => {
              if (match && match.length > 1) {
                const prefix = match[1];
                replace(prefix + fix.text + ' ');
                editor.setCursorBufferPosition([
                  range.start.row,
                  range.start.column + prefix.length + fix.text.length,
                ]);
                stop();
              }
            }
          );
        });
        break;

      case 'Run `elm package install`':
        helper.runElmPackageInstall(fix.directory);
        break;

      case 'Define top-level':
        if (fix.filePath) {
          if (fs.existsSync(fix.filePath)) {
            atom.workspace.open(fix.filePath).then(editor => {
              editor.transact(() => {
                editor.setCursorBufferPosition(editor.getEofBufferPosition());
                editor.insertText('\n\n' + fix.name + ' =\n    ');
              });
            });
          } else {
            fs.writeFileSync(
              fix.filePath,
              'module ' +
                fix.moduleName +
                ' exposing (..)\n\n' +
                fix.name +
                ' =\n    '
            );
            atom.notifications.addInfo('Created ' + fix.filePath, {
              dismissable: true,
            });
            atom.workspace.open(fix.filePath).then(editor => {
              editor.setCursorBufferPosition(editor.getEofBufferPosition());
            });
          }
        } else {
          let topLevelEnd = editor.getEofBufferPosition();
          if (fix.kind !== 'type') {
            // Look for next top-level position.
            editor.scanInBufferRange(
              helper.blockRegex(),
              [range.end, editor.getEofBufferPosition()],
              ({ matchText, range, stop }) => {
                stop();
                topLevelEnd = range.start;
              }
            );
          }
          const atEndOfFile = topLevelEnd.isEqual(
            editor.getEofBufferPosition()
          );
          editor.transact(() => {
            editor.setCursorBufferPosition(topLevelEnd);
            editor.insertText(
              (atEndOfFile ? '\n\n' : '') +
                (fix.kind === 'type' ? 'type ' : '') +
                fix.name +
                (fix.kind === 'type' ? '\n    = ' : ' =\n    ') +
                '\n\n\n'
            );
            editor.setCursorBufferPosition([
              topLevelEnd.row + (atEndOfFile ? 3 : 1),
              fix.kind === 'type' ? 6 : 4,
            ]);
          });
        }
        break;

      case 'Change type annotation':
        editor.backwardsScanInBufferRange(
          typeAnnotationRegex(fix.name),
          [range.start, [0, 0]],
          ({ stop, range, replace }) => {
            stop();
            replace(fix.text + '\n' + fix.name);
            editor.setCursorBufferPosition(range.start);
          }
        );
        break;

      case 'Search for functions matching type':
        if (getFunctionsMatchingTypeFunction) {
          const projectDirectory = helper.lookupElmPackage(
            path.dirname(fix.filePath),
            fix.filePath
          );
          getFunctionsMatchingTypeFunction(
            fix.text,
            projectDirectory,
            fix.filePath
          ).then(functions => {
            showFunctionsMatchingTypeFunction(editor, range, functions);
          });
        }
        break;

      case 'Convert to port module':
        let moduleNameRange = null;
        editor.scanInBufferRange(
          helper.moduleNameRegex(),
          [[0, 0], editor.getEofBufferPosition()],
          ({ matchText, range, stop, replace }) => {
            moduleNameRange = range;
            replace('port ' + matchText);
            editor.setCursorBufferPosition(moduleNameRange.start);
            stop();
          }
        );
        if (moduleNameRange) {
        } else {
          editor.buffer.setTextViaDiff(
            'port module Main exposing (..)' + '\n\n' + editor.getText()
          );
          editor.setCursorBufferPosition([0, 0]);
        }
        break;
    }
  },
};

function getFixesForTaggedProblem(
  problem,
  range,
  regionRange,
  subregionRange,
  editor,
  getFunctionsMatchingTypeFunction
) {
  let matches = null;
  switch (problem.tag) {
    case 'NAMING ERROR':
      // Fixes `naming/unknown-qualifier.elm`:
      matches = problem.details.match(
        /^No module called `(.+)` has been imported\./
      );
      if (matches && matches.length > 1) {
        const suggestionFixes = (problem.suggestions || []).map(suggestion => {
          return {
            type: 'Replace with',
            text: getTextInRange(editor, range).replace(matches[1], suggestion),
          };
        });
        const importFix = [
          {
            type: 'Add import',
            text: 'import ' + matches[1],
          },
        ];
        return suggestionFixes.concat(importFix);
      }
      matches = problem.details.match(
        /^The qualifier `(.+)` is not in scope\./
      );
      if (matches && matches.length > 1) {
        const suggestionFixes = (problem.suggestions || []).map(suggestion => {
          return {
            type: 'Replace with',
            text: getTextInRange(editor, range).replace(matches[1], suggestion),
          };
        });
        const importFix = [
          {
            type: 'Add import',
            text: 'import ' + matches[1],
          },
        ];
        return suggestionFixes.concat(importFix);
      }
      matches = problem.details.match(/^`(.+)` does not expose `(.+)`\./);
      if (matches && matches.length > 2) {
        const moduleName = matches[1];
        const variableName = matches[2];
        let suggestionFixes = [];
        if (problem.suggestions && problem.suggestions.length > 0) {
          suggestionFixes = problem.suggestions.map(suggestion => {
            let rangeTextSegments = getTextInRange(editor, range).split('.');
            rangeTextSegments.pop();
            return {
              type: 'Replace with',
              text: rangeTextSegments.join('.') + '.' + suggestion,
            };
          });
        }
        const isLowerCase =
          name.length > 0 && name[0] === name[0].toLowerCase();
        const editorFilePath = editor.getPath();
        const projectDirectory = helper.lookupElmPackage(
          path.dirname(editorFilePath),
          editorFilePath
        );
        const filePath = path.join(
          projectDirectory,
          moduleName.replace('.', path.sep) + '.elm'
        );
        const defineTopLevelFix = [
          {
            type: 'Define top-level',
            text: variableName + ' (in module ' + moduleName + ')',
            kind: 'variable',
            name: variableName,
            filePath,
            moduleName,
          },
        ];
        const fixes = suggestionFixes.concat(defineTopLevelFix);
        return fixes.length > 0 ? fixes : null;
      }
      // Fixes `naming/ambiguous.elm`, `naming/exposed-unknown.elm`, `naming/qualified-unknown.elm`:
      matches = problem.overview.match(
        /^Cannot find (variable|type|pattern) `(.+)`/
      );
      if (matches && matches.length > 2) {
        const kind = matches[1];
        const name = matches[2];
        let suggestionFixes = [];
        if (problem.suggestions && problem.suggestions.length > 0) {
          suggestionFixes = problem.suggestions.map(suggestion => {
            return {
              type: 'Replace with',
              text: getTextInRange(editor, range).replace(name, suggestion),
            };
          });
        }
        const isLowerCase =
          name.length > 0 && name[0] === name[0].toLowerCase();
        const defineTopLevelFix = [
          {
            type: 'Define top-level',
            text: (kind === 'type' ? 'type ' : '') + name,
            kind,
            name,
          },
        ];
        const fixes = suggestionFixes.concat(defineTopLevelFix);
        return fixes.length > 0 ? fixes : null;
      }
      if (problem.suggestions && problem.suggestions.length > 0) {
        return problem.suggestions.map(suggestion => {
          return {
            type: 'Replace with',
            text: suggestion,
          };
        });
      }
      return null;

    case 'missing type annotation':
      matches = problem.details.match(
        /I inferred the type annotation so you can copy it into your code:\n\n((?:.|\n)+)$/
      );
      if (matches && matches.length > 1) {
        return [
          {
            type: 'Add type annotation',
            text: matches[1],
          },
        ];
      }
      return null;

    case 'TYPE MISMATCH':
      matches = problem.details.match(
        /But I am inferring that the definition has this type:\n\n((?:.|\n)+)\n\nHint: A type annotation is too generic\. You can probably just switch to the type\nI inferred\. These issues can be subtle though, so read more about it\.\n<https:\/\/github\.com\/elm-lang\/elm-compiler\/blob\/\d+\.\d+\.\d+\/hints\/type-annotations\.md>$/
      );
      if (matches && matches.length > 1) {
        return [
          {
            type: 'Replace with',
            text: matches[1],
          },
        ];
      }
      matches = problem.details.match(
        /But I am inferring that the definition has this type:\n\n((?:.|\n)+)$/
      );
      if (matches && matches.length > 1) {
        return [
          {
            type: 'Replace with',
            text: matches[1],
          },
        ];
      }
      matches = problem.details.match(
        /The type of `(.+)` is:\n\n    (?:.*)\n\nWhich does not contain a field named `(?:.*)`\.\n\nHint: The record fields do not match up\. Maybe you made one of these typos\?\n    \n    (.+) <-> (?:.*)/
      );
      if (matches && matches.length > 2) {
        return [
          {
            type: 'Replace with',
            text: matches[1] + '.' + matches[2],
          },
        ];
      }
      // Fixes `types/binop-string-append.elm`:
      if (
        problem.details ===
        '(+) is expecting the left argument to be a:\n\n    number\n\nBut the left argument is:\n\n    String\n\nHint: To append strings in Elm, you need to use the (++) operator, not (+).\n<http://package.elm-lang.org/packages/elm-lang/core/latest/Basics#++>'
      ) {
        // TODO: The linter should highlight the region instead of the subregion.
        let plusRange = null;
        editor.scanInBufferRange(
          /\+/,
          [subregionRange.end, regionRange.end],
          ({ range, stop }) => {
            plusRange = range;
            stop();
          }
        );
        if (plusRange) {
          const textBeforePlus = getTextInRange(
            editor,
            new Range(regionRange.start, plusRange.start)
          );
          const textAfterPlus = getTextInRange(
            editor,
            new Range(plusRange.end, regionRange.end)
          );
          return [
            {
              type: 'Replace with',
              text: textBeforePlus + '++' + textAfterPlus,
              range: regionRange,
            },
          ];
        }
      }
      matches = problem.details.match(
        /^(.+) is expecting the right side to be a:\n\n    ((?:.|\n)+)\n\nBut the right side is:\n\n    ((?:.|\n)+)/
      );
      if (matches && matches.length > 3) {
        const typeAnnotation = matches[3].split('\n\n')[0];
        if (getFunctionsMatchingTypeFunction) {
          return [
            createSearchForFunctionsMatchingTypeFix(
              typeAnnotation,
              matches[2],
              problem.file
            ),
          ];
        }
        return null;
      }
      // Fixes `types/case-2.elm`, `types/case-3.elm`, `types/if-multi.elm`:
      matches = problem.details.match(
        /^The (.+) branch has this type:\n\n    ((?:.|\n)+)\n\nBut the (.+) is:\n\n    ((?:.|\n)+)/
      );
      if (matches && matches.length > 4) {
        const typeAnnotation = matches[4].split('\n\n')[0];
        if (getFunctionsMatchingTypeFunction) {
          return [
            createSearchForFunctionsMatchingTypeFix(
              typeAnnotation,
              matches[2],
              problem.file
            ),
          ];
        }
        return null;
      }
      matches = problem.details.match(
        /^The (.+) entry has this type:\n\n    ((?:.|\n)+)\n\nBut the (.+) is:\n\n    ((?:.|\n)+)/
      );
      if (matches && matches.length > 4) {
        const typeAnnotation = matches[4].split('\n\n')[0];
        if (getFunctionsMatchingTypeFunction) {
          return [
            createSearchForFunctionsMatchingTypeFix(
              typeAnnotation,
              matches[2],
              problem.file
            ),
          ];
        }
        return null;
      }
      matches = problem.overview.match(
        /^Function `(.+)` is expecting (\d+) argument(?:s?), but was given (\d+)\.$/
      );
      if (matches && matches.length > 3) {
        // Remove the extra arguments.
        return [
          {
            type: 'Replace with',
            text: '',
          },
        ];
      }
      matches = problem.details.match(
        /^The type annotation for `(.+)` says it is a:\n\n    ((?:.|\n)+)\n\nBut the definition \(shown above\) is a:\n\n    ((?:.|\n)+)/
      );
      if (matches && matches.length > 3) {
        const name = matches[1];
        const typeAnnotation = matches[3].split('\n\n')[0];
        let fixes = [
          {
            type: 'Change type annotation',
            text: name + ' : ' + typeAnnotation,
            name,
          },
        ];
        if (getFunctionsMatchingTypeFunction) {
          fixes.push(
            createSearchForFunctionsMatchingTypeFix(
              typeAnnotation,
              matches[2],
              problem.file
            )
          );
        }
        return fixes;
      }
      matches = problem.details.match(
        /^The type annotation for `(.+)` says it always returns:\n\n    ((?:.|\n)+)\n\nBut the returned value \(shown above\) is a:\n\n    ((?:.|\n)+)/
      );
      if (matches && matches.length > 3) {
        // NOTE: This should only change the return type (e.g. in `Model -> Cmd Msg`, this should only change `Cmd Msg`)
        const name = matches[1];
        const newReturnType = matches[3].split('\n\n')[0];
        const oldTypeAnnotation = getTypeAnnotation(editor, range, name);
        if (oldTypeAnnotation) {
          const tipeParts = helper.getTipeParts(oldTypeAnnotation);
          // Remove old return type.
          tipeParts.pop();
          tipeParts.push(newReturnType);
          const newTypeAnnotation = tipeParts.join(' -> ');
          let fixes = [
            {
              type: 'Change type annotation',
              text: name + ' : ' + newTypeAnnotation,
              name,
            },
          ];
          if (getFunctionsMatchingTypeFunction) {
            fixes.push(
              createSearchForFunctionsMatchingTypeFix(
                newReturnType,
                matches[2],
                problem.file
              )
            );
          }
          return fixes;
        }
        return null;
      }
      return null;

    case 'ALIAS PROBLEM':
      // Fixes `canonicalize/alias-mutually-recursive.elm`:
      matches = problem.details.match(
        /Try this instead:\n\n((?:.|\n)+)\n\nThis is kind of a subtle distinction\. I suggested the naive fix, but you can\noften do something a bit nicer\. So I would recommend reading more at:\n<https:\/\/github\.com\/elm-lang\/elm-compiler\/blob\/\d+\.\d+\.\d+\/hints\/recursive-alias\.md>$/
      );
      if (matches && matches.length > 1) {
        return [
          {
            type: 'Replace with',
            text: matches[1]
              .split('\n')
              .map(line => {
                return line.slice(4);
              })
              .join('\n'),
          },
        ];
      }
      return null;

    case 'unused import':
      // matches = problem.overview.match(/^Module `(.+)` is unused.$/);
      return [
        {
          type: 'Remove unused import',
          // text: matches[1]
          text: getTextInRange(editor, range),
        },
      ];

    case 'SYNTAX PROBLEM':
      if (
        problem.overview ===
        'The = operator is reserved for defining variables. Maybe you want == instead? Or\nmaybe you are defining a variable, but there is whitespace before it?'
      ) {
        return [
          {
            type: 'Replace with',
            text: '==',
            range: new Range(
              [problem.region.start.line - 1, problem.region.start.column - 1],
              [problem.region.end.line - 1, problem.region.end.column]
            ),
          },
        ];
      }
      if (
        problem.overview ===
        'Arrows are reserved for cases and anonymous functions. Maybe you want > or >=\ninstead?'
      ) {
        return [
          {
            type: 'Replace with',
            text: '>',
            range: new Range(
              [problem.region.start.line - 1, problem.region.start.column - 1],
              [problem.region.end.line - 1, problem.region.end.column + 1]
            ),
          },
          {
            type: 'Replace with',
            text: '>=',
            range: new Range(
              [problem.region.start.line - 1, problem.region.start.column - 1],
              [problem.region.end.line - 1, problem.region.end.column + 1]
            ),
          },
        ];
      }
      if (
        problem.overview ===
        'Vertical bars are reserved for use in union type declarations. Maybe you want ||\ninstead?'
      ) {
        return [
          {
            type: 'Replace with',
            text: '||',
            range: new Range(
              [problem.region.start.line - 1, problem.region.start.column - 1],
              [problem.region.end.line - 1, problem.region.end.column]
            ),
          },
        ];
      }
      if (
        problem.overview ===
        'A single colon is for type annotations. Maybe you want :: instead? Or maybe you\nare defining a type annotation, but there is whitespace before it?'
      ) {
        return [
          {
            type: 'Replace with',
            text: '::',
            range: new Range(
              [problem.region.start.line - 1, problem.region.start.column - 1],
              [problem.region.end.line - 1, problem.region.end.column]
            ),
          },
        ];
      }
      return null;

    case 'MISSING PATTERNS':
      matches = problem.details.match(
        /^You need to account for the following values:\n\n((?:.|\n)+)\n\n(?:Add a branch to cover this pattern!|Add branches to cover each of these patterns!)((?:.|\n)+)$/
      );
      if (matches && matches.length > 1) {
        const moduleName = helper.parseModuleName(editor.getText());
        const patterns = matches[1].split('\n').map(rawPattern => {
          const pattern = rawPattern.replace(helper.tabSpaces(), '');
          // Handle wildcard pattern.
          if (pattern.startsWith('<values besides ')) {
            return '_';
          }
          // Handle default imports.
          // TODO: Get the imported symbols to make this more accurate.
          if (pattern.startsWith('Maybe.Just ')) {
            return pattern.replace('Maybe.Just ', 'Just ');
          }
          if (pattern.startsWith('Maybe.Nothing')) {
            // Note that there's no trailing space here.
            return pattern.replace('Maybe.Nothing', 'Nothing');
          }
          if (pattern.startsWith('Result.Ok ')) {
            return pattern.replace('Result.Ok ', 'Ok ');
          }
          if (pattern.startsWith('Result.Err ')) {
            return pattern.replace('Result.Err ', 'Err ');
          }
          // If pattern starts with the module name of the file, remove the module name.
          const parts = pattern.split('.');
          parts.pop();
          if (
            moduleName &&
            parts.length > 0 &&
            parts.join('.').startsWith(moduleName)
          ) {
            return pattern.replace(moduleName + '.', '');
          }
          return pattern;
        });
        return [
          {
            type: 'Add missing patterns',
            text: patterns
              .map(pattern => {
                return pattern;
              })
              .join(' | '),
            patterns: patterns,
            range: helper.regionToRange(problem.subregion || problem.region),
          },
        ];
      }
      return null;

    case 'REDUNDANT PATTERN':
      // TODO: Return a fix to remove redundant patterns.
      return null;

    case 'BAD PORT':
      regex = /^(All ports must be defined in a `)(port module)(`\. You should probably have just one\nof these for your project\. This way all of your foreign interactions stay\nrelatively organized\.)$/;
      matches = problem.details.match(regex);
      if (matches && matches.length > 3) {
        const moduleName = helper.parseModuleName(editor.getText());
        return [
          {
            type: 'Convert to port module',
            text: 'port module ' + moduleName,
          },
        ];
      }
      return null;

    default:
      return null;
  }
}

function getTextInRange(editor, range) {
  return editor.getTextInBufferRange(range);
}

function typeAnnotationRegex(name) {
  return new RegExp(
    '^' +
      _.escapeRegExp(name) +
      '\\s*:\\s*((?:.|\n)+)\\n' +
      _.escapeRegExp(name),
    'm'
  );
}

function getTypeAnnotation(editor, range, name) {
  let typeAnnotation = null;
  editor.backwardsScanInBufferRange(
    typeAnnotationRegex(name),
    [range.start, [0, 0]],
    ({ match, stop }) => {
      if (match && match.length > 1) {
        stop();
        typeAnnotation = match[1];
      }
    }
  );
  return typeAnnotation;
}

function createSearchForFunctionsMatchingTypeFix(fromType, toType, filePath) {
  return {
    type: 'Search for functions matching type',
    text: adjustTypeVariables(fromType, toType),
    filePath,
  };
}

function adjustTypeVariables(fromType, toType) {
  // TODO: Handle type variables beyond `z`.
  // Remove type variables used by `fromType` from the pool.
  let letters = 'abcdefghijklmnopqrstuvwxyz'.split('');
  const typeVariablesRegex = /\b([a-z]+)\b/g;
  let fromMatch = typeVariablesRegex.exec(fromType);
  while (fromMatch) {
    const name = fromMatch[1];
    let index = letters.indexOf(name);
    if (index != -1) {
      letters.splice(index, 1);
    }
    fromMatch = typeVariablesRegex.exec(fromType);
  }
  let used = {};
  let toMatch = typeVariablesRegex.exec(toType);
  let adjustedToType = toType;
  while (toMatch) {
    const name = toMatch[1];
    if (!['number', 'appendable', 'comparable', 'compappend'].includes(name)) {
      if (letters.length > 0) {
        if (!used[name]) {
          used[name] = letters.shift();
        }
        // Replace type variable with a letter from the pool.
        adjustedToType = adjustedToType.replace(
          new RegExp('(\\b)(' + name + ')(\\b)', 'g'),
          '$1' + used[name] + '$3'
        );
      } else {
        // FIXME
        return fromType + ' -> ' + toType;
      }
    }
    toMatch = typeVariablesRegex.exec(toType);
  }
  return fromType + ' -> ' + adjustedToType;
}
