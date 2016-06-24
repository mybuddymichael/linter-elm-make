'use babel';

const QuickFixView = require('./quick-fix-view');
const Range = require('atom').Range;
const CompositeDisposable = require('atom').CompositeDisposable;
const path = require('path');
const helpers = require('atom-linter');
const fs = require('fs-extra');
const tmp = require('tmp');
const chokidar = require('chokidar');

module.exports = {
  config: {
    elmMakeExecutablePath: {
      title: 'The elm-make executable path.',
      type: 'string',
      default: 'elm-make',
      order: 1
    },
    lintOnTheFly: {
      title: 'Lint On The Fly',
      description: 'Lint files while typing, without the need to save.  Be sure to check the `Lint As You Type` option in the Linter package settings for this to work.',
      type: 'boolean',
      default: false,
      order: 2
    },
    alwaysCompileMain: {
      title: 'Always Compile Main',
      description: 'Always compile `Main.elm` files in source directories instead of the active file.  Modules unreachable from the main modules will not be linted.',
      type: 'boolean',
      default: true,
      order: 3
    },
    reportWarnings: {
      title: 'Report Warnings',
      description: 'Report `elm-make` warnings.',
      type: 'boolean',
      default: true,
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
    this.tempCompileDirectories = {};
    this.problems = {};
    this.quickFixes = {};
    this.quickFixView = new QuickFixView();
    this.subscriptions.add(atom.commands.add('atom-text-editor', {
      'linter-elm-make:quick-fix': this.quickFix.bind(this),
      'linter-elm-make:quick-fix-all': this.quickFixAll.bind(this),
      'linter-elm-make:clear-project-build-artifacts': this.clearProjectBuildArtifacts.bind(this),
      'linter-elm-make:toggle-lint-on-the-fly': this.toggleLintOnTheFly,
      'linter-elm-make:toggle-always-compile-main': this.toggleAlwaysCompileMain,
      'linter-elm-make:toggle-report-warnings': this.toggleReportWarnings
    }));
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
      editor.onDidDestroy(() => {
        if (atom.config.get('linter-elm-make.lintOnTheFly')) {
          // If editor was modified before it was destroyed, revert the contents of the associated temporary file to the actual file's contents.
          if (editor.isModified()) {
            const editorFilePath = editor.getPath();
            if (editorFilePath) {
              const projectDirectory = lookupElmPackage(path.dirname(editorFilePath));
              const tempLintDirectory = self.tempCompileDirectories[projectDirectory];
              if (tempLintDirectory) {
                const tempFilePath = path.join(tempLintDirectory, editorFilePath.replace(projectDirectory, ''));
                fs.writeFileSync(tempFilePath, fs.readFileSync(editorFilePath).toString());
              }
            }
          }
        }
      });
      // TODO When do we delete a project's entries in `this.problems`?
    };
    atom.workspace.observeTextEditors((editor) => {
      if (isElmEditor(editor)) {
        subscribeToElmEditorEvents(editor);
      }
      editor.onDidChangePath((path) => {
        if (isElmEditor(editor)) {
          subscribeToElmEditorEvents(editor);
        } else {
          self.clearElmEditorProblemsAndFixes(editor);
        }
      });
    });
    this.prevElmEditor = null;
    atom.workspace.observeActivePaneItem((item) => {
      if (atom.config.get('linter-elm-make.lintOnTheFly') &&
        item && isElmEditor(item)) {
        if (self.prevElmEditor) {
          // When an editor loses focus, update the associated temporary file.
          const prevTextEditorPath = self.prevElmEditor.getPath();
          if (prevTextEditorPath) {
            const projectDirectory = lookupElmPackage(path.dirname(prevTextEditorPath));
            if (projectDirectory) {
              const tempLintDirectory = self.tempCompileDirectories[projectDirectory];
              if (tempLintDirectory) {
                const tempFilePath = path.join(tempLintDirectory, prevTextEditorPath.replace(projectDirectory, ''));
                fs.writeFileSync(tempFilePath, self.prevElmEditor.getText());
              }
            }
          }
        }
        // Force a lint command when editor gets activated.
        forceLintActiveElmEditor();
        self.prevElmEditor = item;
      } else {
        self.prevElmEditor = null;
      }
    });
  },
  clearElmEditorProblemsAndFixes(editor) {
    const editorFilePath = editor.getPath();
    if (this.problems[editorFilePath]) { delete this.problems[editorFilePath]; }
    if (this.quickFixes[editorFilePath]) { delete this.quickFixes[editorFilePath]; }
  },
  deactivate() {
    this.subscriptions.dispose();
    this.tempCompileDirectories = null;
    this.problems = null;
    this.quickFixes = null;
    this.quickFixView.destroy();
    this.prevElmEditor = null;
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
        if (e !== BreakException) throw e;
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
  toggleLintOnTheFly() {
    const lintOnTheFly = toggleConfig('linter-elm-make.lintOnTheFly');
    atom.notifications.addInfo('"Lint On The Fly" is now ' + (lintOnTheFly ? 'ON' : 'OFF'), {});
    if (lintOnTheFly) {
      forceLintActiveElmEditor();
    }
  },
  toggleAlwaysCompileMain() {
    const alwaysCompileMain = toggleConfig('linter-elm-make.alwaysCompileMain');
    atom.notifications.addInfo('"Always Compile Main" is now ' + (alwaysCompileMain ? 'ON' : 'OFF'), {});
    if (atom.config.get('linter-elm-make.lintOnTheFly')) {
      forceLintActiveElmEditor();
    }
  },
  toggleReportWarnings() {
    const reportWarnings = toggleConfig('linter-elm-make.reportWarnings');
    atom.notifications.addInfo('"Report Warnings" is now ' + (reportWarnings ? 'ON' : 'OFF'), {});
    if (atom.config.get('linter-elm-make.lintOnTheFly')) {
      forceLintActiveElmEditor();
    }
  },
  clearProjectBuildArtifacts() {
    const editor = atom.workspace.getActiveTextEditor();
    const editorFilePath = editor.getPath();
    let deleteBuildArtifacts = (directory) => {
      const files = fs.readdirSync(directory);
      files.forEach((filename) => {
        const ext = path.extname(filename);
        if (ext === '.elmi' || ext === '.elmo') {
          fs.unlinkSync(path.join(directory, filename));
        }
      });
    };
    const self = this;
    getProjectBuildArtifactsDirectory(editorFilePath)
    .then(buildArtifactsDirectory => {
      if (buildArtifactsDirectory) {
        const projectDirectory = lookupElmPackage(path.dirname(editorFilePath));
        deleteBuildArtifacts(buildArtifactsDirectory);
        if (atom.inDevMode()) {
          console.log('linter-elm-make: cleared project directory build artifacts - ' + buildArtifactsDirectory);
        }
        if (atom.config.get('linter-elm-make.lintOnTheFly')) {
          // If linting on the fly, also delete the build artifacts in the temporary directory.
          if (projectDirectory) {
            const tempLintDirectory = self.tempCompileDirectories[projectDirectory];
            if (tempLintDirectory) {
              const tempBuildArtifactsDirectory = buildArtifactsDirectory.replace(projectDirectory, tempLintDirectory);
              deleteBuildArtifacts(tempBuildArtifactsDirectory);
              if (atom.inDevMode()) {
                console.log('linter-elm-make: cleared temporary directory build artifacts - ' + tempBuildArtifactsDirectory);
              }
            }
          }
        }
        atom.notifications.addInfo('Cleared ' + buildArtifactsDirectory.replace(projectDirectory + path.sep, ''), {});
      }
    });
  },
  provideLinter() {
    const proc = process;
    const self = this;
    const linter = {
      grammarScopes: ['source.elm'],
      scope: 'project',
      lintOnFly: true,
      lint(editor) {
        const editorFilePath = editor.getPath();
        if (editorFilePath) {
          const projectDirectory = lookupElmPackage(path.dirname(editorFilePath));
          if (projectDirectory === null) {
            return [];
          }
          if (atom.config.get('linter-elm-make.lintOnTheFly')) {
            // Lint on the fly.
            // If `tempCompileDirectories` does not have an entry for `projectDirectory` yet...
            if (!self.tempCompileDirectories[projectDirectory]) {
              // Create a temporary directory for the project.
              const tempLintDirectory = tmp.dirSync({prefix: 'linter-elm-make'}).name;
              if (atom.inDevMode()) {
                console.log('linter-elm-make: created temporary directory - ' + projectDirectory + ' -> ' + tempLintDirectory);
              }
              self.tempCompileDirectories[projectDirectory] = tempLintDirectory;
              // Recursively copy `.elm` files, `elm-package.json`, and `elm-stuff` from project directory to temporary directory.
              // Initial linting might take time depending on the project directory size.
              fs.copySync(projectDirectory, tempLintDirectory, {
                preserveTimestamps: true,
                filter: (filePath) => {
                  return path.dirname(filePath).replace(projectDirectory, '').startsWith(path.sep + 'elm-stuff' + path.sep) ||
                    path.basename(filePath) === 'elm-package.json' ||
                    path.extname(filePath) === '.elm';
                }
              });
              // TODO Do not copy folders without `.elm` files (`fs-extra` issue).
              // Watch project directory for file changes.
              let watcher = chokidar.watch(['elm-package.json', '**/*.elm'], {
                cwd: projectDirectory,
                usePolling: true, useFsEvents: true, persistent: true,
                ignored: ['**/elm-stuff/**/*.elm', '**\elm-stuff\**\*.elm'], ignoreInitial: true,
                followSymlinks: false, interval: 100, alwaysStat: false, depth: undefined,
                awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
                ignorePermissionErrors: false, atomic: false
              });
              watcher.on('add', (filename) => {
                if (path.basename === 'elm-package.json' || path.extname(filename) === '.elm') {
                  const filePath = path.join(projectDirectory, filename);
                  if (atom.inDevMode()) {
                    console.log('linter-elm-make: add detected - ', filePath);
                  }
                  fs.copySync(filePath, path.join(tempLintDirectory, filename));
                }
              });
              watcher.on('unlink', (filename) => {
                if (atom.inDevMode()) {
                  console.log('linter-elm-make: unlink detected - ', path.join(projectDirectory, filename));
                }
                fs.removeSync(path.join(tempLintDirectory, filename));
              });
              watcher.on('unlinkDir', (dirname) => {
                if (atom.inDevMode()) {
                  console.log('linter-elm-make: unlinkDir detected - ', path.join(projectDirectory, dirname));
                }
                fs.removeSync(path.join(tempLintDirectory, dirname));
              });
              watcher.on('change', (filename) => {
                if (path.basename === 'elm-package.json') {
                  forceLintActiveElmEditor();
                }
              });
              // TODO Handle when projectDirectory gets renamed or deleted.
              // TODO When to close watcher, delete temporary directory, and delete self.tempCompileDirectories[projectDirectory]?
              return self.compileInTempDirectory(editorFilePath, tempLintDirectory, editor, projectDirectory);
            }
            // If `projectDirectory` already has an entry in `tempCompileDirectories`...
            return self.compileInTempDirectory(editorFilePath, self.tempCompileDirectories[projectDirectory], editor, projectDirectory);
          } else {
            // Lint on save.
            if (atom.config.get('linter-elm-make.alwaysCompileMain')) {
              return self.compileMainFiles(editorFilePath, projectDirectory, projectDirectory, editor, (mainFilePath) => mainFilePath);
            } else {
              // Compile active file.
              return self.executeElmMake(editorFilePath, editorFilePath, projectDirectory, editor, projectDirectory);
            }
          }
        }
        return [];
      }
    };
    this.subscriptions.add(atom.config.observe('linter-elm-make.lintOnTheFly', lintOnTheFly => {
      linter.lintOnFly = lintOnTheFly;
    }));
    return linter;
  },
  provideGetCompileDirectory() {
    const self = this;
    return (projectDirectory) => {
      return self.tempCompileDirectories[projectDirectory];
    };
  },
  compileInTempDirectory(editorFilePath, tempLintDirectory, editor, projectDirectory) {
    const tempFilePath = path.join(tempLintDirectory, editorFilePath.replace(projectDirectory, ''));
    // Write contents of active editor to associated temporary file.
    fs.writeFileSync(tempFilePath, editor.getText());
    if (atom.config.get('linter-elm-make.alwaysCompileMain')) {
      return this.compileMainFiles(editorFilePath, projectDirectory, tempLintDirectory, editor, (mainFilePath) => mainFilePath.replace(projectDirectory, tempLintDirectory));
    } else {
      // Compile active file.
      return this.executeElmMake(editorFilePath, tempFilePath, tempLintDirectory, editor, projectDirectory);
    }
  },
  compileMainFiles(editorFilePath, projectDirectory, cwd, editor, mainFilePathTransformFunction) {
    const mainFilePaths = this.getMainFilePaths(projectDirectory);
    if (mainFilePaths) {
      // Compile the `Main.elm` file of each source directory, then combine the linting results.
      const elmMakePromises = mainFilePaths.map((mainFilePath) => {
        return this.executeElmMake(editorFilePath, mainFilePathTransformFunction(mainFilePath), cwd, editor, projectDirectory);
      });
      return Promise.all(elmMakePromises).then((results) => {
        return flattenArray(results);
      });
    } else {
      return [];
    }
  },
  getMainFilePaths(projectDirectory) {
    let json = fs.readJsonSync(path.join(projectDirectory, 'elm-package.json'), {throws: false});
    // TODO Check if `sourceDirectories` is an array of strings.
    const sourceDirectories = json['source-directories'];
    if (sourceDirectories) {
      const mainFilePaths =
        sourceDirectories
        .map((sourceDirectory) => {
          return path.join(projectDirectory, sourceDirectory, 'Main.elm');
        })
        .filter((mainFilePath) => {
          // TODO If `Main.elm` does not exist, look for the file containing `main =`?
          return fs.existsSync(mainFilePath);
        });
      if (mainFilePaths.length > 0) {
        return mainFilePaths;
      } else {
        atom.notifications.addError('Could not find `Main.elm` in `' + sourceDirectories.map((directory) => '"' + directory + '"').join(', ') + '`', {});
        return null;
      }
    }
  },
  consumeStatusBar(statusBar) {
    module.statusBar = statusBar;
  },
  executeElmMake(editorFilePath, inputFilePath, cwd, editor, projectDirectory) {
    const executablePath = atom.config.get('linter-elm-make.elmMakeExecutablePath');
    const progressIndicator = module.statusBar.addLeftTile({
      item: createProgressIndicator(),
      priority: 1
    });
    let args = [inputFilePath, '--report=json', '--output=/dev/null', '--yes'];
    if (atom.config.get('linter-elm-make.reportWarnings')) {
      args.push('--warn');
    }
    let self = this;
    return helpers.exec(executablePath, args, {
      stream: 'both', // stdout and stderr
      cwd: cwd,
      env: process.env
    })
    .then(data => {
      let result;
      if (data.stderr === '') {
        result = self.parseStdout(data.stdout, editorFilePath, inputFilePath, cwd, editor, projectDirectory);
      } else {
        result = self.parseStderr(data.stderr, editorFilePath);
      }
      progressIndicator.destroy();
      return result;
    })
    .catch(errorMessage => {
      atom.notifications.addError('Failed to run ' + executablePath, {
        detail: errorMessage
      });
      progressIndicator.destroy();
      return [];
    });
  },
  parseStdout(stdout, editorFilePath, inputFilePath, cwd, editor, projectDirectory) {
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
        if (!atom.config.get('linter-elm-make.reportWarnings')) {
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
          let filePath = problem.file;
          if (problem.file.startsWith('.')) {
            // `problem.file` has a relative path (e.g. `././A.elm`) . Convert to absolute.
            filePath = path.join(cwd, path.normalize(problem.file));
          }
          if (cwd !== projectDirectory) {
            // problem.file is a temporary file
            filePath = filePath.replace(cwd, projectDirectory);
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
        return problem.filePath.startsWith(projectDirectory);
      });
    });
    const allProblems = flattenArray(problemsWithNonTempFiles);
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
    const editorFilePath = editor.getPath();
    const problems = this.problems[editorFilePath];
    if (problems) {
      const quickFixes =
        problems.map(({problem, range}) => {
          return {
            fixes: getFixesForProblem(problem, editor.getTextInBufferRange(range)),
            range: range
          };
        })
        .filter(({fixes}) => {
          return fixes !== null;
        });
      this.quickFixes[editorFilePath] = quickFixes;
      return quickFixes;
    } else {
      this.quickFixes[editorFilePath] = [];
      return null;
    }
  },
  parseStderr(stderr, editorFilePath) {
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
        filePath: editorFilePath,
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
      atom.notifications.addError("No elm-package.json beneath or above the edited file", {});
      return null;
    } else {
      return lookupElmPackage(parentDirectory);
    }
  }
}

function getProjectBuildArtifactsDirectory(filePath) {
  if (filePath) {
    const projectDirectory = lookupElmPackage(path.dirname(filePath));
    if (projectDirectory === null) {
      return null;
    }
    const executablePath = atom.config.get('linter-elm-make.elmMakeExecutablePath');
    return helpers.exec(executablePath, ['--help'], {
      stream: 'stdout',
      cwd: projectDirectory,
      env: process.env
    })
    .then(data => {
      var elmPlatformVersion = data.split('\n')[0].match(/\(Elm Platform (.*)\)$/)[1];
      let json = fs.readJsonSync(path.join(projectDirectory, 'elm-package.json'), {throws: false});
      if (json) {
        if (json.repository && json.version) {
          const matches = json.repository.match(/^(.+)\/(.+)\/(.+)\.git$/);
          const user = matches[2];
          const project = matches[3];
          if (user && project) {
            return path.join(projectDirectory, 'elm-stuff', 'build-artifacts', elmPlatformVersion, user, project, json.version);
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
      atom.notifications.addError('Failed to run ' + executablePath, {
        detail: errorMessage
      });
      return null;
    });
  }
  return null;
}

function toggleConfig(key) {
  const oldValue = atom.config.get(key);
  const newValue = !oldValue;
  atom.config.set(key, newValue);
  return newValue;
}

function forceLintActiveElmEditor() {
  const editor = atom.workspace.getActiveTextEditor();
  if (isElmEditor(editor)) {
    atom.commands.dispatch(atom.views.getView(editor), 'linter:lint');
  }
}

function isElmEditor(editor) {
  return editor && editor.getPath && editor.getPath() && path.extname(editor.getPath()) === '.elm';
}

function flattenArray(arr) {
  return [].concat.apply([], arr);
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
      matches = problem.details.match(/I inferred the type annotation so you can copy it into your code:\n\n((.|\n)*)$/);
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
