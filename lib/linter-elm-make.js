"use babel";

const QuickFixView = require('./quick-fix-view');
const BufferedProcess = require('atom').BufferedProcess;
const Range = require('atom').Range;
const path = require('path');
const fs = require('fs');
const helpers = require('atom-linter');
const CompositeDisposable = require('atom').CompositeDisposable;

module.exports = {
  config: {
    elmMakeExecutablePath: {
      title: 'The elm-make executable path.',
      type: 'string',
      default: 'elm-make',
      order: 1
    },
    onlyLintOnSave: {
      title: 'Only Lint On Save',
      description:  'Only lint upon saving the file, not while typing.',
      type: 'boolean',
      default: false,
      order: 2
    },
    ignoreWarnings: {
      title: 'Ignore Warnings',
      description:  'Do not report elm-make warnings.',
      type: 'boolean',
      default: false,
      order: 3
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
    this.quickFixes = {};
    this.quickFixView = new QuickFixView();
    this.quickFixView.onDidConfirm(({textEditor, range, fix}) => {
      fixProblem(textEditor, range, fix);
    });
    atom.commands.add('atom-text-editor', {
      'linter-elm-make:quick-fix': this.quickFix.bind(this),
      'linter-elm-make:quick-fix-all': this.quickFixAll.bind(this)
    });
    const self = this;
    atom.workspace.observeTextEditors((textEditor) => {
      textEditor.onDidDestroy(() => {
        if (self.quickFixes[textEditor.getPath()]) {
          delete self.quickFixes[textEditor.getPath()];
        }
      });
    });
    this.subscriptions = new CompositeDisposable();
  },
  deactivate() {
    this.subscriptions.dispose();
    this.quickFixView.destroy();
  },
  quickFix() {
    var textEditor = atom.workspace.getActiveTextEditor();
    const position = textEditor.getLastCursor().getBufferPosition();
    // Look for fixes for the issue at cursor position.
    var fixesForPosition = null;
    const quickFixes = this.quickFixes[textEditor.getPath()];
    if (quickFixes) {
      const BreakException = {};
      try {
        quickFixes.forEach(({range, fixes}) => {
          if (range.containsPoint(position)) {
            // Fix found! Get out of loop.
            fixesForPosition = {range, fixes};
            throw BreakException;
          }
        });
      } catch(e) {
        if (e!==BreakException) throw e;
      }
    }
    if (fixesForPosition) {
      this.quickFixView.show(textEditor, fixesForPosition.range, fixesForPosition.fixes);
    } else {
      atom.notifications.addError('No quick fixes found.');
    }
  },
  quickFixAll() {
    var textEditor = atom.workspace.getActiveTextEditor();
    var marker = null;
    var markers = [];
    const quickFixes = this.quickFixes[textEditor.getPath()];
    if (quickFixes) {
      textEditor.transact(() => {
        quickFixes.forEach(({range, fixes}) => {
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
    }
  },
  provideLinter() {
    const proc = process;
    const self = this;
    const linter = {
      grammarScopes: ['source.elm'],
      scope: 'file',
      lintOnFly: true,
      lint(textEditor) {
        const filePath = textEditor.getPath();
        if (filePath) {
          if (!atom.config.get('linter-elm-make.onlyLintOnSave')) {
            return helpers.tempFile(path.basename(filePath), textEditor.getText(), (tempFilePath) => {
              return self.doLint(filePath, tempFilePath, textEditor);
            });
          } else {
            return self.doLint(filePath, filePath, textEditor);
          }
        } else {
          return [];
        }
      }
    };
    this.subscriptions.add(atom.config.observe('linter-elm-make.onlyLintOnSave', onlyLintOnSave => {
        linter.lintOnFly = !onlyLintOnSave;
    }));
    return linter;
  },
  consumeStatusBar(statusBar) {
    module.statusBar = statusBar;
  },
  doLint(filePath, inputFilePath, textEditor) {
    const executablePath = atom.config.get('linter-elm-make.elmMakeExecutablePath');
    const projectRootDirectory = lookupElmPackage(path.dirname(filePath));
    if (projectRootDirectory === null) {
      atom.notifications.addError("No elm-package.json beneath or above the edited file", {});
      return [];
    }
    const progressIndicator = module.statusBar.addLeftTile({
      item: createProgressIndicator(),
      priority: 1
    });
    let args = [inputFilePath, '--report=json', '--output=/dev/null', '--yes'];
    if (!atom.config.get('linter-elm-make.ignoreWarnings')) {
      args.push('--warn');
    }
    let self = this;
    return helpers.exec(executablePath, args, {
      stream: 'both',
      cwd: projectRootDirectory,
      env: process.env
    })
    .then(data => {
      return new Promise((resolve, reject) => {
        if (data.stderr === '') {
          self.parseStdout(data.stdout, filePath, inputFilePath, projectRootDirectory, textEditor, resolve);
        } else {
          self.parseStderr(data.stderr, filePath, resolve);
        }
        progressIndicator.destroy();
      });
    })
    .catch(errorMessage => {
      atom.notifications.addError("Failed to run " + executablePath, {
        detail: errorMessage
      });
      progressIndicator.destroy();
      return [];
    });
  },
  parseStdout(stdout, filePath, inputFilePath, projectRootDirectory, textEditor, resolve) {
    const problemsByLine = stdout.split('\n').map((line) => {
      var json = (() => {
        try {
          return JSON.parse(line);
        } catch (error) {
          // elm-make outputs other lines besides the report
        }
      })();
      if (!json) {
        return [];
      } else {
        if (atom.config.get('linter-elm-make.ignoreWarnings')) {
          json = json.filter(problem => { return problem.type !== 'warning'; });
        }
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
          let fpath;
          if (problem.file === inputFilePath && filePath !== inputFilePath) {
            // `problem.file` is a temporary file. Use associated file's path.
            fpath = filePath;
          } else if (problem.file.startsWith('.')) {
            // `problem.file` has a relative path. Convert to absolute.
            fpath = path.join(projectRootDirectory, path.normalize(problem.file));
          } else {
            fpath = problem.file;
          }
          return {
            type: problem.type,
            html: `${colorize(problem.overview)}<br/><br/>${colorize(problem.details.split('\n').join('<br/>&nbsp;'))}`,
            filePath: fpath,
            range: range,
            fixes: getFixesForProblem(problem, textEditor.getTextInBufferRange(range))
          };
        });
      }
    });
    const problemsWithNonTempFiles = problemsByLine.map((problems) => {
      return problems.filter((problem) => {
        // Filter out temporary files.
        return problem.filePath.startsWith(projectRootDirectory);
      });
    });
    const allProblems = [].concat.apply([], problemsWithNonTempFiles);
    // Naive implementation.
    this.quickFixes[filePath] =
      allProblems
      .filter(({fixes}) => { return fixes !== null; })
      .map(({filePath, range, fixes}) => {
        return {
          range: range,
          fixes: fixes
        };
      });
    resolve(allProblems);
  },
  parseStderr(stderr, filePath, resolve) {
    const stderrLines = stderr.split('\n');
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
      matches = problem.details.match(/^The qualifier `(.*)` is not in scope\./);
      if (matches && matches.length > 1) {
        var fixes = (problem.suggestions || []).map((suggestion) => {
          return {
            type: 'Replace with',
            text: rangeText.replace(matches[1], suggestion)
          };
        });
        fixes.push({
          type: 'Add import',
          text: 'import ' + matches[1]
        });
        return fixes;
      }
      matches = problem.details.match(/^`(.*)` does not expose (.*)\./);
      if (matches && matches.length > 1 && problem.suggestions && problem.suggestions.length > 0) {
        return problem.suggestions.map((suggestion) => {
          let rangeTextSegments = rangeText.split('.');
          rangeTextSegments.pop();
          return {
            type: 'Replace with',
            text: rangeTextSegments.join('.') + '.' + suggestion
          };
        });
      }
      matches = problem.overview.match(/^Cannot find variable `(.*)`/);
      if (matches && matches.length > 1 && problem.suggestions && problem.suggestions.length > 0) {
        return problem.suggestions.map((suggestion) => {
          return {
            type: 'Replace with',
            text: rangeText.replace(matches[1], suggestion)
          };
        });
      }
      matches = problem.overview.match(/^Cannot find type `(.*)`/);
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
      matches = problem.details.match(/I inferred the type annotation so you can copy it into your code:\n\n(.*)$/);
      if (matches && matches.length > 1) {
        return [{
          type: 'Add type annotation',
          text: matches[1]
        }];
      }
      return null;
    case 'TYPE MISMATCH':
      matches = problem.details.match(/But I am inferring that the definition has this type:\n\n    (.*)\n\nHint: A type annotation is too generic\. You can probably just switch to the type\nI inferred\. These issues can be subtle though, so read more about it\.\n<https:\/\/github\.com\/elm-lang\/elm-compiler\/blob\/\d+\.\d+\.\d+\/hints\/type-annotations\.md>$/);
      if (matches && matches.length > 1) {
        return [{
          type: 'Replace with',
          text: matches[1]
        }];
      }
      matches = problem.details.match(/But I am inferring that the definition has this type:\n\n    (.*)$/);
      if (matches && matches.length > 1) {
        return [{
          type: 'Replace with',
          text: matches[1]
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
      matches = problem.details.match(/Try this instead:\n\n((.|\n)*)\n\nThis is kind of a subtle distinction\. I suggested the naive fix, but you can\noften do something a bit nicer\. So I would recommend reading more at:\n<https:\/\/github\.com\/elm-lang\/elm-compiler\/blob\/\d+\.\d+\.\d+\/hints\/recursive-alias\.md>$/);
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
    case 'SYNTAX PROBLEM':
      if (problem.overview === 'I need whitespace, but got stuck on what looks like a new declaration. You are\neither missing some stuff in the declaration above or just need to add some\nspaces here:') {
        return [{
          type: 'Insert',
          text: '4 spaces'
        }];
      }
      return null;
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
    case 'Insert':
      textEditor.indent();
      break;
    case 'Add import':
      // Insert below the last import, or module declaration.
      var insertRange = [0, 0];
      textEditor.backwardsScanInBufferRange(/^(import|module)\s/, [textEditor.getEofBufferPosition(), [0, 0]], (iter) => {
        insertRange = iter.range.traverse([1, 0]);
        iter.stop();
      });
      textEditor.setTextInBufferRange(insertRange, fix.text + '\n');
      break;
  }
}
