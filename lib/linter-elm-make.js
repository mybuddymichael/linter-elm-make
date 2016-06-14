"use babel";

const QuickFixView = require('./quick-fix-view');
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
      description: 'Only lint upon saving the file, not while typing.',
      type: 'boolean',
      default: false,
      order: 2
    },
    alwaysCompileMain: {
      title: 'Always Compile `Main.elm`',
      description: 'Always compile `Main.elm` instead of the active file.  Will not be able to lint modules which are unreachable from the main module.  This will only work if `Only Lint On Save` is checked, for now.',
      type: 'boolean',
      default: false,
      order: 3
    },
    ignoreWarnings: {
      title: 'Ignore Warnings',
      description: 'Do not report elm-make warnings.',
      type: 'boolean',
      default: false,
      order: 4
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
    this.subscriptions = new CompositeDisposable();
    this.problems = {};
    this.quickFixes = {};
    this.quickFixView = new QuickFixView();
    atom.commands.add('atom-text-editor', {
      'linter-elm-make:quick-fix': this.quickFix.bind(this),
      'linter-elm-make:quick-fix-all': this.quickFixAll.bind(this),
      'linter-elm-make:toggle-only-lint-on-save': this.toggleOnlyLintOnSave,
      'linter-elm-make:toggle-always-compile-main': this.toggleAlwaysCompileMain,
      'linter-elm-make:clear-project-build-artifacts': this.clearProjectBuildArtifacts
    });
    const self = this;
    this.quickFixView.onDidConfirm(({editor, range, fix}) => {
      fixProblem(editor, range, fix);
      self.clearElmEditorProblemsAndFixes(editor);
    });
    let subscribeToElmEditorEvents = (editor) => {
      editor.onDidStopChanging(() => {
        if (editor.isModified()) {
          // We need to check if editor was modified since saving also triggers `onDidStopChanging`.
          self.clearElmEditorProblemsAndFixes(editor);
        }
      });
      // TODO When do we delete all of a project's entries in `this.problems`?
    };
    atom.workspace.observeTextEditors((editor) => {
      if (editor.getGrammar().scopeName === 'source.elm') {
        subscribeToElmEditorEvents(editor);
      }
      editor.onDidChangeGrammar((grammar) => {
        if (grammar.scopeName === 'source.elm') {
          subscribeToElmEditorEvents(editor);
        } else {
          self.clearElmEditorProblemsAndFixes(editor);
        }
      });
    });
  },
  clearElmEditorProblemsAndFixes(editor) {
    const editorPath = editor.getPath();
    if (this.problems[editorPath]) { delete this.problems[editorPath]; }
    if (this.quickFixes[editorPath]) { delete this.quickFixes[editorPath]; }
  },
  deactivate() {
    this.subscriptions.dispose();
    this.problems = null;
    this.quickFixes = null;
    this.quickFixView.destroy();
  },
  quickFix() {
    const editor = atom.workspace.getActiveTextEditor();
    const position = editor.getLastCursor().getBufferPosition();
    // Look for fixes for the issue at cursor position.
    var fixesForPosition = null;
    const quickFixes = this.quickFixes[editor.getPath()] || this.computeFixesForEditor(editor);
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
      this.quickFixView.show(editor, fixesForPosition.range, fixesForPosition.fixes);
    } else {
      atom.notifications.addError('No quick fixes found.');
    }
  },
  quickFixAll() {
    const editor = atom.workspace.getActiveTextEditor();
    var markers = [];
    var marker = null;
    const quickFixes = this.quickFixes[editor.getPath()] || this.computeFixesForEditor(editor);
    if (quickFixes) {
      editor.transact(() => {
        quickFixes.forEach(({range, fixes}) => {
          marker = editor.markBufferRange(range, {invalidate: 'never', persistent: false});
          marker.setProperties({fixes: fixes});
          markers.push(marker);
        });
        markers.forEach((marker) => {
          fixProblem(editor, marker.getBufferRange(), marker.getProperties().fixes[0]);
          marker.destroy();
        });
        markers = null;
      });
      this.clearElmEditorProblemsAndFixes(editor);
    }
  },
  toggleOnlyLintOnSave() {
    const newValue = toggleConfig('linter-elm-make.onlyLintOnSave');
    atom.notifications.addInfo('"Only Lint On Save" is now ' + (newValue ? 'ON' : 'OFF'), {});
  },
  toggleAlwaysCompileMain() {
    const newValue = toggleConfig('linter-elm-make.alwaysCompileMain');
    atom.notifications.addInfo('"Always Compile Main.elm" is now ' + (newValue ? 'ON' : 'OFF'), {});
  },
  clearProjectBuildArtifacts() {
    const editor = atom.workspace.getActiveTextEditor();
    const filePath = editor.getPath();
    if (filePath) {
      const projectRootDirectory = lookupElmPackage(path.dirname(filePath));
      if (projectRootDirectory === null) {
        atom.notifications.addError('No elm-package.json beneath or above the edited file', {});
        return;
      }
      const executablePath = atom.config.get('linter-elm-make.elmMakeExecutablePath');
      helpers.exec(executablePath, ['--help'], {
        stream: 'stdout',
        cwd: projectRootDirectory,
        env: process.env
      })
      .then(data => {
        var elmPlatformVersion = data.split('\n')[0].match(/\(Elm Platform (.*)\)$/)[1];
        let json = (() => {
          try {
            return JSON.parse(fs.readFileSync(path.join(projectRootDirectory, 'elm-package.json')).toString());
          } catch (error) {
          }
        })();
        if (json) {
          if (json.repository && json.version) {
            const matches = json.repository.match(/^(.+)\/(.+)\/(.+)\.git$/);
            const user = matches[2];
            const project = matches[3];
            if (user && project) {
              const directory = path.join(projectRootDirectory, 'elm-stuff', 'build-artifacts', elmPlatformVersion, user, project, json.version);
              const files = fs.readdirSync(directory);
              files.forEach((filename) => {
                const ext = path.extname(filename);
                if (ext === '.elmi' || ext === '.elmo') {
                  fs.unlinkSync(path.join(directory, filename));
                }
              });
              atom.notifications.addInfo('Cleared ' + directory, {});
            } else {
              atom.notifications.addError('Could not determine the value of "user" and/or "project"', {});
            }
          } else {
            atom.notifications.addError('Field "repository" and/or "version" not found in elm-package.json', {});
          }
        } else {
          atom.notifications.addError('Error parsing elm-package.json', {});
        }
      })
      .catch(errorMessage => {
        atom.notifications.addError("Failed to run " + executablePath, {
          detail: errorMessage
        });
      });
    }
  },
  provideLinter() {
    const proc = process;
    const self = this;
    const linter = {
      grammarScopes: ['source.elm'],
      // scope: 'file',
      scope: 'project',
      lintOnFly: true,
      lint(editor) {
        const filePath = editor.getPath();
        if (filePath) {
          const projectRootDirectory = lookupElmPackage(path.dirname(filePath));
          if (projectRootDirectory === null) {
            atom.notifications.addError("No elm-package.json beneath or above the edited file", {});
            return [];
          }
          if (atom.config.get('linter-elm-make.onlyLintOnSave')) {
            if (atom.config.get('linter-elm-make.alwaysCompileMain')) {
              let json = (() => {
                try {
                  return JSON.parse(fs.readFileSync(path.join(projectRootDirectory, 'elm-package.json')).toString());
                } catch (error) {
                }
              })();
              // TODO Check if `sourceDirectories` is an array of strings.
              const sourceDirectories = json['source-directories'];
              if (sourceDirectories) {
                // TODO For each source directory, compile `Main.elm`. Concatenate the results.
                const sourceDirectory = sourceDirectories[0]; // Gets the first source directory for now.
                const mainFilePath = path.join(projectRootDirectory, sourceDirectory, 'Main.elm');
                if (fs.existsSync(mainFilePath)) {
                  return self.doLint(filePath, mainFilePath, projectRootDirectory, editor);
                } else {
                  // TODO if `Main.elm` does not exist, look for the file having a `main` function.
                  atom.notifications.addError('Could not find `Main.elm`', {});
                }
              }
              return [];
            }
            return self.doLint(filePath, filePath, projectRootDirectory, editor);
          } else {
            // On-the-fly linting.
            return helpers.tempFile(path.basename(filePath), editor.getText(), (tempFilePath) => {
              return self.doLint(filePath, tempFilePath, projectRootDirectory, editor);
            });
          }
        }
        return [];
      }
    };
    this.subscriptions.add(atom.config.observe('linter-elm-make.onlyLintOnSave', onlyLintOnSave => {
      linter.lintOnFly = !onlyLintOnSave;
      if (!onlyLintOnSave && atom.config.get('linter-elm-make.alwaysCompileMain')) {
        atom.config.set('linter-elm-make.alwaysCompileMain', false);
      }
    }));
    this.subscriptions.add(atom.config.observe('linter-elm-make.alwaysCompileMain', alwaysCompileMain => {
      // linter.scope = alwaysCompileMain ? 'project' : 'file';
      if (alwaysCompileMain) {
        atom.config.set('linter-elm-make.onlyLintOnSave', true);
      }
    }));
    return linter;
  },
  consumeStatusBar(statusBar) {
    module.statusBar = statusBar;
  },
  doLint(editorFilePath, inputFilePath, projectRootDirectory, editor) {
    const executablePath = atom.config.get('linter-elm-make.elmMakeExecutablePath');
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
      stream: 'both', // stdout and stderr
      cwd: projectRootDirectory,
      env: process.env
    })
    .then(data => {
      let result;
      if (data.stderr === '') {
        result = self.parseStdout(data.stdout, editorFilePath, inputFilePath, projectRootDirectory, editor);
      } else {
        result = self.parseStderr(data.stderr, editorFilePath);
      }
      progressIndicator.destroy();
      return result;
    })
    .catch(errorMessage => {
      atom.notifications.addError("Failed to run " + executablePath, {
        detail: errorMessage
      });
      progressIndicator.destroy();
      return [];
    });
  },
  parseStdout(stdout, editorFilePath, inputFilePath, projectRootDirectory, editor) {
    const problemsByLine = stdout.split('\n').map((line) => {
      let json = (() => {
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
          let filePath;
          if (!atom.config.get('linter-elm-make.alwaysCompileMain') &&
            !atom.config.get('linter-elm-make.onlyLintOnSave') &&
            problem.file === inputFilePath && editorFilePath !== inputFilePath) {
            // `problem.file` is a temporary file. Use associated file's path.
            filePath = editorFilePath;
          } else if (problem.file.startsWith('.')) {
            // `problem.file` has a relative path (e.g. `././A.elm`) . Convert to absolute.
            filePath = path.join(projectRootDirectory, path.normalize(problem.file));
          } else {
            filePath = problem.file;
          }
          return {
            type: problem.type,
            html: `${colorize(problem.overview)}<br/><br/>${colorize(problem.details.split('\n').join('<br/>&nbsp;'))}`,
            filePath: filePath,
            range: range,
            problem: problem
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
    // Flatten problem array.
    const allProblems = [].concat.apply([], problemsWithNonTempFiles);
    // Store problems for each file path.
    const uniqueFilePaths = new Set(allProblems.map(({filePath}) => filePath));
    let getProblemsOfFilePath = (fpath) => {
      return allProblems.filter(({filePath}) => {
        return filePath === fpath;
      });
    };
    for (let filePath of uniqueFilePaths) {
      this.problems[filePath] = getProblemsOfFilePath(filePath);
    }
    // Only compute quick fixes for the active editor.
    // Quick fixes for the other editors will be computed on demand (upon calling `quick-fix` or `quick-fix-all`).
    this.computeFixesForEditor(editor);
    return allProblems;
  },
  computeFixesForEditor(editor) {
    const filePath = editor.getPath();
    const problems = this.problems[filePath];
    if (problems) {
      const quickFixes = problems.map(({problem, range}) => {
        return {
          fixes: getFixesForProblem(problem, editor.getTextInBufferRange(range)),
          range: range
        };
      });
      this.quickFixes[filePath] = quickFixes;
      return quickFixes;
    } else {
      this.quickFixes[filePath] = [];
      return null;
    }
  },
  parseStderr(stderr, filePath) {
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
    return [
      {
        type: "error",
        html: `${stderrLines.join('<br/>')}`,
        filePath: filePath,
        range: [
          [lineNumber, 0],
          [lineNumber, 0]
        ] // TODO search for invalid import
      }
    ];
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

function toggleConfig(key) {
  const oldValue = atom.config.get(key);
  const newValue = !oldValue;
  atom.config.set(key, newValue);
  return newValue;
}

function getFixesForProblem(problem, rangeText) {
  var matches = null;
  switch (problem.tag) {
    case 'NAMING ERROR':
      matches = problem.details.match(/^The qualifier `(.*)` is not in scope\./);
      if (matches && matches.length > 1) {
        let fixes = (problem.suggestions || []).map((suggestion) => {
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

function fixProblem(editor, range, fix) {
  switch (fix.type) {
    case 'Replace with':
      editor.setTextInBufferRange(range, fix.text);
      break;
    case 'Add type annotation':
      // Insert type annotation above the line.
      const leadingSpaces = new Array(range.start.column).join(' ');
      editor.setTextInBufferRange([range.start, range.start], fix.text + '\n' + leadingSpaces);
      break;
    case 'Remove unused import':
      editor.buffer.deleteRow(range.start.row);
      break;
    case 'Insert':
      editor.indent();
      break;
    case 'Add import':
      // Insert below the last import, or module declaration.
      var insertRange = [0, 0];
      editor.backwardsScanInBufferRange(/^(import|module)\s/, [editor.getEofBufferPosition(), [0, 0]], (iter) => {
        insertRange = iter.range.traverse([1, 0]);
        iter.stop();
      });
      editor.setTextInBufferRange(insertRange, fix.text + '\n');
      break;
  }
}
