"use babel";

const QuickFixView = require('./quick-fix-view');
const BufferedProcess = require('atom').BufferedProcess;
const Range = require('atom').Range;
const path = require("path");
const fs = require("fs");

module.exports = {
  config: {
    elmMakeExecutablePath: {
      title: 'The elm-make executable path.',
      type: 'string',
      default: 'elm-make',
    }
  },
  activate() {
    if (!atom.packages.getLoadedPackage('language-elm')) {
      atom.notifications.addError("The Elm language package wasn't found.", {
        detail: 'Please install the `language-elm` package in your Settings view.'
      });
    }
    if (!atom.packages.getLoadedPackage('linter')) {
      atom.notifications.addError('The linter package not found.', {
        detail: 'Please install the `linter` package in your Settings view'
      });
    }
    module.exports.quickFixes = {};
    module.exports.quickFixView = new QuickFixView();
    module.exports.quickFixView.onDidConfirm(({textEditor, range, fix}) => {
      fixProblem(textEditor, range, fix);
    });
    atom.commands.add('atom-text-editor', {
      'linter-elm-make:quick-fix': module.exports.quickFix,
      'linter-elm-make:quick-fix-all': module.exports.quickFixAll
    });
  },
  deactivate() {
    module.exports.quickFixView.destroy();
  },
  quickFix() {
    var textEditor = atom.workspace.getActiveTextEditor();
    const textEditorPath = textEditor.getPath();
    const position = textEditor.getLastCursor().getBufferPosition();
    // Look for fixes for the issue at cursor position.
    var fixesForPosition = null;
    const BreakException = {};
    try {
      module.exports.quickFixes[textEditor.getPath()].forEach(({range, fixes}) => {
        if (range.containsPoint(position)) {
          // Fix found! Get out of loop.
          fixesForPosition = {range, fixes};
          throw BreakException;
        }
      });
    } catch(e) {
      if (e!==BreakException) throw e;
    }
    if (fixesForPosition) {
      module.exports.quickFixView.show(textEditor, fixesForPosition.range, fixesForPosition.fixes);
    } else {
      atom.beep();
      atom.notifications.addError('No quick fixes found.');
    }
  },
  quickFixAll() {
    var textEditor = atom.workspace.getActiveTextEditor();
    var marker = null;
    var markers = [];
    textEditor.transact(() => {
      module.exports.quickFixes[textEditor.getPath()].forEach(({range, fixes}) => {
        marker = textEditor.markBufferRange(range, {invalidate: 'never', persistent: false});
        marker.setProperties({fixes: fixes});
        markers.push(marker);
      });
      markers.forEach((marker) => {
        fixProblem(textEditor, marker.getBufferRange(), marker.getProperties().fixes[0]);
        marker.destroy();
      });
      markers = null;
    });
  },
  provideLinter() {
    const proc = process;
    return {
      grammarScopes: ['source.elm'],
      scope: 'file',
      lintOnFly: false,
      lint(textEditor) {
        return new Promise((resolve, reject) => {
          const filePath = textEditor.getPath();
          const executablePath = atom.config.get('linter-elm-make.elmMakeExecutablePath');
          const cwd = lookupElmPackage(path.dirname(textEditor.getPath()));
          if (cwd === null) {
            atom.notifications.addError("No elm-package.json beneath or above the edited file", {
            });
            return;
          }
          const options = {
            cwd: cwd,
            env: proc.env
          };
          const stderrLines = [];
          const progressIndicator = module.statusBar.addLeftTile({
            item: createProgressIndicator(),
            priority: 1
          });
          const process = new BufferedProcess({
            command: executablePath,
            args: [filePath, '--warn', '--report=json', '--output=/dev/null', '--yes'],
            options: options,
            stdout(data) {
              const problemsByLine = data.split('\n').map((line) => {
                const json = (() => {
                  try {
                    return JSON.parse(line);
                  } catch (error) {
                    // elm-make outputs other lines besides the report
                  }
                })();
                if (!json) {
                  return [];
                } else {
                  return json.map((problem) => {
                    const colorize = ((msg) => {
                      return msg.split("[33m").join("<span style='color:orange'>")
                        .split("[0m").join("</span>")
                        .split(" `").join(" `<span style='font-weight:bold'>")
                        .split("` ").join("</span>` ");
                    });
                    const range = new Range(
                      [problem.region.start.line - 1, problem.region.start.column - 1],
                      [problem.region.end.line - 1, problem.region.end.column - 1]
                    );
                    return {
                      type: problem.type,
                      html: `${colorize(problem.overview)}<br/><br/>${colorize(problem.details.split('\n').join('<br/>&nbsp;'))}`,
                      filePath: problem.file || filePath,
                      range: range,
                      fixes: getFixesForProblem(problem, textEditor.getTextInBufferRange(range))
                    };
                  });
                }
              });
              const allProblems = [].concat.apply([], problemsByLine);
              // Naive implementation.
              module.exports.quickFixes[filePath] =
                allProblems
                .filter(({fixes}) => { return fixes !== null; })
                .map(({filePath, range, fixes}) => {
                  return {
                    range: range,
                    fixes: fixes
                  };
                });
              resolve(allProblems);
              progressIndicator.destroy();
            },
            stderr(data) {
              stderrLines.push(data);
            },
            exit(code) {
              var lineNumber = 0;
              const lineNumberRegexp = /^(\d+)\|.*/g;
              stderrLines.forEach((line) => {
                const matches = lineNumberRegexp.exec(line);
                if (matches !== null) {
                  matches.forEach((match) => {
                    lineNumber = parseInt(match) - 1;
                  });
                }
              });
              resolve([
                {
                  type: "error",
                  html: `${stderrLines.join('<br/>')}`,
                  filePath: filePath,
                  range: [
                    [lineNumber, 0],
                    [lineNumber, 0]
                  ] // TODO search for invalid import
                }
              ]);
              progressIndicator.destroy();
            }
          });
          process.onWillThrowError(({error, handle}) => {
            atom.notifications.addError("Failed to run " + executablePath, {
              detail: error.message
            });
            handle();
            return resolve([]);
          });
        });
      }
    };
  },
  consumeStatusBar(statusBar) {
    module.statusBar = statusBar;
  }
};

function createProgressIndicator() {
  const result = document.createElement("div");
  result.classList.add("inline-block");
  result.classList.add("icon-ellipsis");
  result.innerHTML = "Linting...";
  return result;
}

function lookupElmPackage(directory) {
  if (fs.existsSync(path.join(directory, "elm-package.json"))) {
    return directory;
  } else {
    const parentDirectory = path.join(directory, "..");
    if (parentDirectory === directory) {
      return null;
    } else {
      return lookupElmPackage(parentDirectory);
    }
  }
}

function getFixesForProblem(problem, rangeText) {
  var matches = null;
  switch (problem.tag) {
    case 'NAMING ERROR':
      if (!problem.suggestions || problem.suggestions.length === 0) {
        return null;
      }
      matches = problem.details.match(/`(.*)` does not expose (.*). Maybe you want one of the following\?\n\n((.|\n)*)$/);
      if (matches && matches.length > 1) {
        return problem.suggestions.map((suggestion) => {
          return {
            type: 'Replace with',
            text: matches[1] + '.' + suggestion
          };
        });
      }
      matches = problem.details.match(/The qualifier `(.*)` is not in scope. Maybe you want one of the following\?\n\n((.|\n)*)$/);
      if (matches && matches.length > 1) {
        return problem.suggestions.map((suggestion) => {
          return {
            type: 'Replace with',
            text: rangeText.replace(matches[1], suggestion)
          };
        });
      }
      matches = problem.overview.match(/^Cannot find type `(.*)`$/);
      if (matches && matches.length > 1) {
        return problem.suggestions.map((suggestion) => {
          return {
            type: 'Replace with',
            text: rangeText.replace(matches[1], suggestion)
          };
        });
      }
      return problem.suggestions.map((suggestion) => {
        return {
          type: 'Replace with',
          text: suggestion
        };
      });
    case 'missing type annotation':
      matches = problem.details.match(/I inferred the type annotation so you can copy it into your code:\n\n(.*)$/);
      if (matches && matches.length > 1) {
        return [{
          type: 'Add type annotation',
          text: matches[1]
        }];
      }
      return null;
    case 'TYPE MISMATCH':
      // TODO: The type annotation is saying:\n\n    (.*)\n\nBut I am inferring that the definition has this type:\n\n    (.*)$
      matches = problem.details.match(/But I am inferring that the definition has this type:\n\n    (.*)\n\nHint: A type annotation is too generic\. You can probably just switch to the type\nI inferred\. These issues can be subtle though, so read more about it\.\n<https:\/\/github\.com\/elm-lang\/elm-compiler\/blob\/0\.16\.0\/hints\/type-annotations\.md>$/);
      if (matches && matches.length > 1) {
        return [{
          type: 'Replace with',
          text: matches[1]
        }];
      } else if (problem.details === "(+) is expecting the left argument to be a:\n\n    number\n\nBut the left argument is:\n\n    String\n\nHint: To append strings in Elm, you need to use the (++) operator, not (+).\n<http://package.elm-lang.org/packages/elm-lang/core/latest/Basics#++>") {
        return [{
          type: 'Replace with',
          text: rangeText.replace(/\+/, '++')
        }];
      }
      return null;
    case 'ALIAS PROBLEM':
      matches = problem.details.match(/Try this instead:\n\n((.|\n)*)\n\nThis is kind of a subtle distinction\. I suggested the naive fix, but you can\noften do something a bit nicer\. So I would recommend reading more at:\n<https:\/\/github\.com\/elm-lang\/elm-compiler\/blob\/0\.16\.0\/hints\/recursive-alias\.md>$/);
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
      // matches = problem.overview.match(/^Module `(.*)` is unused.$/);
      return [{
        type: 'Remove unused import',
        // text: matches[1]
        text: rangeText
      }];
    default:
      return null;
  }
}

function fixProblem(textEditor, range, fix) {
  switch (fix.type) {
    case 'Replace with':
      textEditor.setTextInBufferRange(range, fix.text);
      break;
    case 'Add type annotation':
      // Insert type annotation above the line.
      const leadingSpaces = new Array(range.start.column).join(' ');
      textEditor.setTextInBufferRange([range.start, range.start], fix.text + '\n' + leadingSpaces);
      break;
    case 'Remove unused import':
      textEditor.buffer.deleteRow(range.start.row);
      break;
  }
}
