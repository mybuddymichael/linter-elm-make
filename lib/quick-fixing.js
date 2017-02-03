'use babel';

import {Range} from 'atom';
import path from 'path';
import helper from './helper';

export default {
  // TODO: Tests.
  getFixesForProblem(problem, rangeText, editor) {
    if (problem.tag) {
      return getFixesForTaggedProblem(problem, rangeText, editor);
    }
    let matches = null;
    matches = problem.match(/^The module name is messed up for (.+)\n\n    According to the file's name it should be (.+)\n    According to the source code it should be (.+)\n\nWhich is it\?$/);
    if (matches && matches.length > 2) {
      const projectDirectory = helper.lookupElmPackage(path.dirname(editor.getPath()));
      return [{
        type: 'Fix module name',
        filePath: path.resolve(projectDirectory, matches[1]),
        text: matches[2]
      }];
    }
    return null;
  },

  // TODO: Tests.
  // As a workaround for `Intentions` limitation, add a class in `linter-elm-make.less` for each fix type.
  fixProblem(editor, range, fix) {
    switch (fix.type) {
      case 'Replace with':
        editor.setTextInBufferRange(fix.range ? fix.range : range, fix.text);
        break;

      case 'Add type annotation':
        // Insert type annotation above the line.
        const leadingSpaces = new Array(range.start.column).join(' ');
        editor.setTextInBufferRange([range.start, range.start], fix.text + '\n' + leadingSpaces);
        // Remove type annotation marker, if any.
        const markers = editor.findMarkers({fixType: 'Add type annotation', fixRange: range});
        if (markers) {
          markers.forEach((marker) => {
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
        editor.scanInBufferRange(allImportsRegex, [[0, 0], editor.getEofBufferPosition()], ({matchText, range, stop}) => {
          if (!(new RegExp('^' + fix.text, 'm').test(matchText))) {
            const insertPoint = range.end.traverse([1, 0]);
            editor.setTextInBufferRange([insertPoint, insertPoint], fix.text + '\n');
          }
          alreadyImported = true;
          stop();
        });
        if (!alreadyImported) {
          const moduleRegex = /(?:^|\n)((effect|port)\s+)?module\s+([\w\.]+)(?:\s+exposing\s*\(((?:\s*(?:\w+|\(.+\))\s*,)*)\s*((?:\.\.|\w+|\(.+\)))\s*\))?(\s*^{-\|([\s\S]*?)-}\s*|)/m;
          editor.scanInBufferRange(moduleRegex, [[0, 0], editor.getEofBufferPosition()], ({range, stop}) => {
            const insertPoint = range.end.traverse([1, 0]);
            editor.setTextInBufferRange([insertPoint, insertPoint], '\n' + fix.text + '\n');
            alreadyImported = true;
            stop();
          });
        }
        if (!alreadyImported) {
          editor.setTextInBufferRange([[0,0], [0,0]], fix.text + '\n');
        }
        break;

      case 'Add missing patterns':
        editor.transact(() => {
          const leadingSpaces = new Array(fix.range.start.column + 1).join(' ') + helper.tabSpaces();
          editor.setCursorBufferPosition(fix.range.end);
          const patternsString = fix.patterns.map((pattern) => {
            return '\n\n' +
              leadingSpaces + pattern + ' ->\n' +
              leadingSpaces + helper.tabSpaces() + 'Debug.crash "TODO"';
          }).join('');
          editor.insertText(patternsString);
        });
        break;

      case 'Remove redundant patterns':
        // TODO
        break;

      case 'Fix module name':
        atom.workspace.open(fix.filePath).then((editor) => {
          editor.scanInBufferRange(/(?:^|\n)((?:(?:effect|port)\s+)?module(?:\s+))(\S+)\s/, [[0, 0], editor.getEofBufferPosition()], ({match, range, replace, stop}) => {
            const prefix = match[1];
            replace(prefix + fix.text + ' ');
            editor.setCursorBufferPosition([
              range.start.row,
              range.start.column + prefix.length + fix.text.length
            ]);
            stop();
          });
        });
        break;
    }
  }
};

function getFixesForTaggedProblem(problem, rangeText, editor) {
  let matches = null;
  switch (problem.tag) {
    case 'NAMING ERROR':
      matches = problem.details.match(/^No module called `(.+)` has been imported\./);
      if (matches && matches.length > 1) {
        const suggestionFixes = (problem.suggestions || []).map((suggestion) => {
          return {
            type: 'Replace with',
            text: rangeText.replace(matches[1], suggestion)
          };
        });
        const importFix = [{
          type: 'Add import',
          text: 'import ' + matches[1]
        }];
        return suggestionFixes.concat(importFix);
      }
      matches = problem.details.match(/^The qualifier `(.+)` is not in scope\./);
      if (matches && matches.length > 1) {
        const suggestionFixes = (problem.suggestions || []).map((suggestion) => {
          return {
            type: 'Replace with',
            text: rangeText.replace(matches[1], suggestion)
          };
        });
        const importFix = [{
          type: 'Add import',
          text: 'import ' + matches[1]
        }];
        return suggestionFixes.concat(importFix);
      }
      matches = problem.details.match(/^`(.+)` does not expose (.+)\./);
      if (matches && matches.length > 1 && problem.suggestions && problem.suggestions.length > 0) {
        const suggestionFixes = problem.suggestions.map((suggestion) => {
          let rangeTextSegments = rangeText.split('.');
          rangeTextSegments.pop();
          return {
            type: 'Replace with',
            text: rangeTextSegments.join('.') + '.' + suggestion
          };
        });
        return suggestionFixes;
      }
      matches = problem.overview.match(/^Cannot find (?:variable|type|pattern) `(.+)`/);
      if (matches && matches.length > 1 && problem.suggestions && problem.suggestions.length > 0) {
        const suggestionFixes = problem.suggestions.map((suggestion) => {
          return {
            type: 'Replace with',
            text: rangeText.replace(matches[1], suggestion)
          };
        });
        return suggestionFixes;
      }
      matches = problem.overview.match(/^Cannot find type `(.+)`/);
      if (matches && matches.length > 1 && problem.suggestions && problem.suggestions.length > 0) {
        return problem.suggestions.map((suggestion) => {
          return {
            type: 'Replace with',
            text: rangeText.replace(matches[1], suggestion)
          };
        });
      }
      if (problem.suggestions && problem.suggestions.length > 0) {
        return problem.suggestions.map((suggestion) => {
          return {
            type: 'Replace with',
            text: suggestion
          };
        });
      }
      return null;

    case 'missing type annotation':
      matches = problem.details.match(/I inferred the type annotation so you can copy it into your code:\n\n((?:.|\n)+)$/);
      if (matches && matches.length > 1) {
        return [{
          type: 'Add type annotation',
          text: matches[1]
        }];
      }
      return null;

    case 'TYPE MISMATCH':
      matches = problem.details.match(/But I am inferring that the definition has this type:\n\n((?:.|\n)+)\n\nHint: A type annotation is too generic\. You can probably just switch to the type\nI inferred\. These issues can be subtle though, so read more about it\.\n<https:\/\/github\.com\/elm-lang\/elm-compiler\/blob\/\d+\.\d+\.\d+\/hints\/type-annotations\.md>$/);
      if (matches && matches.length > 1) {
        return [{
          type: 'Replace with',
          text: matches[1]
        }];
      }
      matches = problem.details.match(/But I am inferring that the definition has this type:\n\n((?:.|\n)+)$/);
      if (matches && matches.length > 1) {
        return [{
          type: 'Replace with',
          text: matches[1]
        }];
      }
      matches = problem.details.match(/The type of `(.+)` is:\n\n    (?:.*)\n\nWhich does not contain a field named `(?:.*)`\.\n\nHint: The record fields do not match up\. Maybe you made one of these typos\?\n    \n    (.+) <-> (?:.*)/);
      if (matches && matches.length > 2) {
        return [{
          type: 'Replace with',
          text: matches[1] + '.' + matches[2]
        }];
      }
      if (problem.details === "(+) is expecting the left argument to be a:\n\n    number\n\nBut the left argument is:\n\n    String\n\nHint: To append strings in Elm, you need to use the (++) operator, not (+).\n<http://package.elm-lang.org/packages/elm-lang/core/latest/Basics#++>") {
        return [{
          type: 'Replace with',
          text: rangeText.replace(/\+/, '++')
        }];
      }
      return null;

    case 'ALIAS PROBLEM':
      matches = problem.details.match(/Try this instead:\n\n((?:.|\n)+)\n\nThis is kind of a subtle distinction\. I suggested the naive fix, but you can\noften do something a bit nicer\. So I would recommend reading more at:\n<https:\/\/github\.com\/elm-lang\/elm-compiler\/blob\/\d+\.\d+\.\d+\/hints\/recursive-alias\.md>$/);
      if (matches && matches.length > 1) {
        return [{
          type: 'Replace with',
          text: matches[1].split('\n').map((line) => {
            return line.slice(4);
          }).join('\n')
        }];
      }
      return null;

    case 'unused import':
      // matches = problem.overview.match(/^Module `(.+)` is unused.$/);
      return [{
        type: 'Remove unused import',
        // text: matches[1]
        text: rangeText
      }];

    case 'SYNTAX PROBLEM':
      if (problem.overview === 'The = operator is reserved for defining variables. Maybe you want == instead? Or\nmaybe you are defining a variable, but there is whitespace before it?') {
        return [{
          type: 'Replace with',
          text: '==',
          range: new Range(
            [problem.region.start.line - 1, problem.region.start.column - 1],
            [problem.region.end.line - 1, problem.region.end.column])
        }];
      }
      if (problem.overview === 'Arrows are reserved for cases and anonymous functions. Maybe you want > or >=\ninstead?') {
        return [{
          type: 'Replace with',
          text: '>',
          range: new Range(
            [problem.region.start.line - 1, problem.region.start.column - 1],
            [problem.region.end.line - 1, problem.region.end.column + 1])
        }, {
          type: 'Replace with',
          text: '>=',
          range: new Range(
            [problem.region.start.line - 1, problem.region.start.column - 1],
            [problem.region.end.line - 1, problem.region.end.column + 1])
        }];
      }
      if (problem.overview === 'Vertical bars are reserved for use in union type declarations. Maybe you want ||\ninstead?') {
        return [{
          type: 'Replace with',
          text: '||',
          range: new Range(
            [problem.region.start.line - 1, problem.region.start.column - 1],
            [problem.region.end.line - 1, problem.region.end.column])
        }];
      }
      if (problem.overview === 'A single colon is for type annotations. Maybe you want :: instead? Or maybe you\nare defining a type annotation, but there is whitespace before it?') {
        return [{
          type: 'Replace with',
          text: '::',
          range: new Range(
            [problem.region.start.line - 1, problem.region.start.column - 1],
            [problem.region.end.line - 1, problem.region.end.column])
        }];
      }
      return null;

    case 'MISSING PATTERNS':
      matches = problem.details.match(/^You need to account for the following values:\n\n((?:.|\n)+)\n\n(?:Add a branch to cover this pattern!|Add branches to cover each of these patterns!)((?:.|\n)+)$/);
      if (matches && matches.length > 1) {
        const moduleName = helper.parseModuleName(editor.getText());
        const patterns = matches[1].split('\n').map((rawPattern) => {
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
          if (moduleName && parts.length > 0 && parts.join('.').startsWith(moduleName)) {
            return pattern.replace(moduleName + '.', '');
          }
          return pattern;
        });
        return [{
          type: 'Add missing patterns',
          text: patterns.map((pattern) => {
            return pattern;
          }).join(' | '),
          patterns: patterns,
          range: helper.regionToRange(problem.subregion || problem.region)
        }];
      }
      return null;

    case 'REDUNDANT PATTERN':
      // TODO: Return a fix to remove redundant patterns.
      return null;

    default:
      return null;
  }
}
