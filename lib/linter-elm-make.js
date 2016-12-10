'use babel';

import Config from './config';
import QuickFixView from './quick-fix-view';
import SetMainPathsView from './set-main-paths-view';
import {Range, CompositeDisposable} from 'atom';
import path from 'path';
import fs from 'fs-extra';
import tmp from 'tmp';
import _ from 'underscore';
import chokidar from 'chokidar';
import readDir from 'readdir';
import Queue from 'promise-queue';
const atomLinter = require('atom-linter');

export default {
  config: Config,
  activate() {
    if (!atom.packages.isPackageLoaded('language-elm')) {
      atom.notifications.addError("The `language-elm` package was not loaded", {
        detail: 'Please install or enable the `language-elm` package in your Settings view.',
        dismissable: true
      });
    }
    if (!atom.packages.isPackageLoaded('linter') &&
        (!atom.packages.isPackageLoaded('nuclide-diagnostics-store') &&
         !atom.packages.isPackageLoaded('nuclide-diagnostics-ui'))) {
      atom.notifications.addError("The `linter` package was not loaded", {
        detail: 'Please install or enable the `linter` package in your Settings view.',
        dismissable: true
      });
    }
    // If `elm-format` is installed and there are errors/warnings, the red/yellow squigglies will disappear after saving.
    // The workaround here is to monkey patch the success() function of `elm-format` to refresh the lint results.
    const elmFormat = atom.packages.getLoadedPackage('elm-format');
    if (elmFormat) {
      const originalSuccessFunction = elmFormat.mainModule.success;
      elmFormat.mainModule.success = (str) => {
        const returnValue = originalSuccessFunction(str);
        refreshLintResultsOfActiveElmEditor();
        return returnValue;
      };
    }
    this.subscriptions = new CompositeDisposable();
    this.lintQueue = new Queue(1, Infinity);
    this.workDirectories = {};
    this.watchers = {};
    this.problems = {};
    this.quickFixes = {};
    this.quickFixView = new QuickFixView();
    this.setMainPathsView = new SetMainPathsView();
    this.subscriptions.add(atom.commands.add('atom-text-editor', {
      'linter-elm-make:quick-fix': this.quickFix.bind(this),
      'linter-elm-make:quick-fix-all': this.quickFixAll.bind(this),
      'linter-elm-make:set-main-paths': this.setMainPaths.bind(this),
      'linter-elm-make:clear-project-build-artifacts': this.clearProjectBuildArtifacts.bind(this),
      // 'linter-elm-make:clear-build-artifacts': this.clearBuildArtifacts.bind(this),
      'linter-elm-make:toggle-lint-on-the-fly': this.toggleLintOnTheFly,
      'linter-elm-make:toggle-always-compile-main': this.toggleAlwaysCompileMain,
      'linter-elm-make:toggle-report-warnings': this.toggleReportWarnings
    }));
    const self = this;
    this.quickFixView.onDidConfirm(({editor, range, fix}) => {
      fixProblem(editor, range, fix);
      self.clearElmEditorProblemsAndFixes(editor);
    });
    this.setMainPathsView.onDidConfirm(({projectDirectory, mainPaths}) => {
      const jsonFilePath = path.join(projectDirectory, 'linter-elm-make.json');
      let json;
      if (fs.existsSync(jsonFilePath)) {
        json = fs.readJsonSync(jsonFilePath, {throws: false});
        if (!json) {
          atom.notifications.addError('Error reading `linter-elm-make.json`', {dismissable: true});
          return;
        }
        json.mainPaths = mainPaths;
      } else {
        json = {mainPaths: mainPaths};
      }
      fs.writeJsonSync(jsonFilePath, json);
      atom.notifications.addSuccess('Set main paths to `[' + mainPaths.map((mainPath) => '"' + mainPath + '"').join(', ') + ']` in `linter-elm-make.json`', {});
      if (atom.config.get('linter-elm-make.lintOnTheFly')) {
        forceLintActiveElmEditor();
      }
    });
    this.updateLinterUIDebouncer = null;
    let subscribeToElmEditorEvents = (editor) => {
      self.subscriptions.add(editor.onDidChangeCursorPosition(() => {
        self.updateLinterUI();
      }));
      self.subscriptions.add(editor.onDidStopChanging(() => {
        if (editor.isModified()) {
          // We need to check if editor was modified since saving also triggers `onDidStopChanging`.
          self.clearElmEditorProblemsAndFixes(editor);
          self.updateLinterUI();
        } else {
          if (atom.config.get('linter-elm-make.lintOnTheFly')) {
            self.clearElmEditorProblemsAndFixes(editor);
            forceLintActiveElmEditor();
          }
        }
      }));
      self.subscriptions.add(editor.onDidDestroy(() => {
        if (atom.config.get('linter-elm-make.lintOnTheFly')) {
          // If editor was modified before it was destroyed, revert the contents of the associated work file to the actual file's contents.
          if (editor.isModified()) {
            const editorFilePath = editor.getPath();
            if (editorFilePath) {
              const projectDirectory = lookupElmPackage(path.dirname(editorFilePath));
              const workDirectory = self.workDirectories[projectDirectory];
              if (workDirectory) {
                const workFilePath = path.join(workDirectory, editorFilePath.replace(projectDirectory, ''));
                fs.writeFileSync(workFilePath, fs.readFileSync(editorFilePath).toString());
              }
            }
          }
        }
      }));
      // TODO When do we delete a project's entries in `this.problems`?
    };
    this.subscriptions.add(atom.workspace.observeTextEditors((editor) => {
      if (isElmEditor(editor)) {
        subscribeToElmEditorEvents(editor);
      }
      self.subscriptions.add(editor.onDidChangePath((path) => {
        if (isElmEditor(editor)) {
          subscribeToElmEditorEvents(editor);
        } else {
          self.clearElmEditorProblemsAndFixes(editor);
        }
      }));
    }));
    this.prevElmEditor = null;
    this.subscriptions.add(atom.workspace.observeActivePaneItem((item) => {
      if (item && isElmEditor(item)) {
        if (atom.config.get('linter-elm-make.lintOnTheFly')) {
          if (self.prevElmEditor) {
            // When an editor loses focus, update the associated work file.
            const prevTextEditorPath = self.prevElmEditor.getPath();
            if (prevTextEditorPath) {
              const projectDirectory = lookupElmPackage(path.dirname(prevTextEditorPath));
              if (projectDirectory) {
                const workDirectory = self.workDirectories[projectDirectory];
                if (workDirectory) {
                  const workFilePath = path.join(workDirectory, prevTextEditorPath.replace(projectDirectory, ''));
                  if (fs.existsSync(workFilePath)) {
                    // Ignore if work file does not exist, yet.
                    fs.writeFileSync(workFilePath, self.prevElmEditor.getText());
                  }
                }
              }
            }
          }
          forceLintActiveElmEditor();
          self.prevElmEditor = item;
        } else {
          self.prevElmEditor = null;
        }
        self.updateLinterUI();
      } else {
        self.prevElmEditor = null;
      }
    }));
  },
  deactivate() {
    if (this.updateLinterUIDebouncer) {
      clearTimeout(this.updateLinterUIDebouncer);
      this.updateLinterUIDebouncer = null;
    }
    this.subscriptions.dispose();
    this.subscriptions = null;
    this.lintQueue = null;
    this.workDirectories = null;
    this.watchers = null;
    this.problems = null;
    this.quickFixes = null;
    this.quickFixView.destroy();
    this.quickFixView = null;
    this.setMainPathsView.destroy();
    this.setMainPathsView = null;
    this.prevElmEditor = null;
    if (this.quickFixesIndicator) {
      this.quickFixesIndicator.destroy();
      this.quickFixesIndicator = null;
    }
  },
  clearElmEditorProblemsAndFixes(editor) {
    const editorFilePath = editor.getPath();
    if (this.problems[editorFilePath]) { delete this.problems[editorFilePath]; }
    if (this.quickFixes[editorFilePath]) { delete this.quickFixes[editorFilePath]; }
  },
  quickFix() {
    const fixesForCursorPosition = this.getFixesAtCursorPosition();
    if (fixesForCursorPosition) {
      this.quickFixView.show(atom.workspace.getActiveTextEditor(), fixesForCursorPosition.range, fixesForCursorPosition.fixes);
    } else {
      atom.notifications.addError('No quick fixes found');
    }
  },
  quickFixAll() {
    const editor = atom.workspace.getActiveTextEditor();
    let markers = [];
    let marker = null;
    const quickFixes = this.quickFixes[editor.getPath()] || this.computeQuickFixesForEditor(editor);
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
  setMainPaths() {
    const editor = atom.workspace.getActiveTextEditor();
    const editorFilePath = editor.getPath();
    if (editorFilePath) {
      const projectDirectory = lookupElmPackage(path.dirname(editorFilePath));
      if (!projectDirectory) {
        return;
      }
      const jsonFilePath = path.join(projectDirectory, 'linter-elm-make.json');
      let json;
      if (fs.existsSync(jsonFilePath)) {
        json = fs.readJsonSync(jsonFilePath, {throws: false});
      }
      const mainPaths = (json && json.mainPaths) || [];
      this.setMainPathsView.show(editorFilePath.replace(projectDirectory + path.sep, ''), projectDirectory, mainPaths);
    }
  },
  // Deletes the .elmi and .elmo files in your project's build artifacts directory (e.g. elm-stuff/build-artifacts/0.17.0/user/project/1.0.0).
  clearProjectBuildArtifacts() {
    const editor = atom.workspace.getActiveTextEditor();
    const editorFilePath = editor.getPath();
    let deleteBuildArtifacts = (directory) => {
      if (!fs.existsSync(directory)) {
        return false;
      }
      const files = fs.readdirSync(directory);
      files.forEach((filename) => {
        const ext = path.extname(filename);
        if (ext === '.elmi' || ext === '.elmo') {
          fs.unlinkSync(path.join(directory, filename));
        }
      });
      return true;
    };
    const self = this;
    getProjectBuildArtifactsDirectory(editorFilePath)
      .then(buildArtifactsDirectory => {
        if (buildArtifactsDirectory) {
          const projectDirectory = lookupElmPackage(path.dirname(editorFilePath));
          const buildArtifactsDirectoryCleared = deleteBuildArtifacts(buildArtifactsDirectory);
          if (buildArtifactsDirectoryCleared && atom.config.get('linter-elm-make.logDebugMessages')) {
            devLog('Cleared project directory build artifacts - ' + buildArtifactsDirectory, 'green');
          }
          if (atom.config.get('linter-elm-make.lintOnTheFly')) {
            // If linting on the fly, also delete the build artifacts in the work directory.
            if (projectDirectory) {
              const workDirectory = self.workDirectories[projectDirectory];
              if (workDirectory) {
                const workDirectoryBuildArtifactsDirectory = buildArtifactsDirectory.replace(projectDirectory, workDirectory);
                const workDirectoryBuildArtifactsDirectoryCleared = deleteBuildArtifacts(workDirectoryBuildArtifactsDirectory);
                if (workDirectoryBuildArtifactsDirectoryCleared && atom.config.get('linter-elm-make.logDebugMessages')) {
                  devLog('Cleared work directory build artifacts - ' + workDirectoryBuildArtifactsDirectory, 'green');
                }
              }
            }
          }
          atom.notifications.addSuccess('Cleared `' + buildArtifactsDirectory.replace(projectDirectory + path.sep, '') + '`', {});
        }
      });
  },
  provideLinter() {
    const proc = process;
    const self = this;
    const linter = {
      name: 'Elm',
      grammarScopes: ['source.elm'],
      scope: 'project',
      lintOnFly: true,
      lint(editor) {
        const editorFilePath = editor.getPath();
        if (!editorFilePath) {
          return [];
        }
        const projectDirectory = lookupElmPackage(path.dirname(editorFilePath));
        if (projectDirectory === null) {
          return [];
        }
        return new Promise((resolve) => {
          self.lintQueue.add(() => {
            return self.doLint(editorFilePath, projectDirectory, editor)
              .then((result) => {
                return resolve(result);
              });
          });
        });
      }
    };
    const removeWatchersAndWorkDirectories = () => {
      for (let projectDirectory in self.watchers) {
        if (self.watchers.hasOwnProperty(projectDirectory)) {
          self.watchers[projectDirectory].close();
        }
      }
      self.watchers = {};
      self.workDirectories = {};
      // TODO Also delete temporary directories.
    };
    this.subscriptions.add(atom.config.observe('linter-elm-make.lintOnTheFly', lintOnTheFly => {
      linter.lintOnFly = lintOnTheFly;
      if (!lintOnTheFly) {
        removeWatchersAndWorkDirectories();
      }
    }));
    this.subscriptions.add(atom.config.observe('linter-elm-make.workDirectory', workDirectory => {
      removeWatchersAndWorkDirectories();
    }));
    return linter;
  },
  maybeCopyProjectToWorkDirectory(projectDirectory) {
    const self = this;
    return new Promise((resolve) => {
      const configWorkDirectory = atom.config.get('linter-elm-make.workDirectory');
      if (configWorkDirectory && configWorkDirectory.trim() !== '') {
        if (!self.workDirectories[projectDirectory]) {
          const workDirectory = path.resolve(projectDirectory, configWorkDirectory);
          self.workDirectories[projectDirectory] = workDirectory;
          // If work directory does not exist, create it and copy source files from project directory.
          if (!fs.existsSync(workDirectory)) {
            devLog('Created work directory - ' + projectDirectory + ' -> ' + workDirectory, 'green');
            const self = this;
            self.copyProjectToWorkDirectory(projectDirectory, workDirectory)
              .then(() => {
                self.watchProjectDirectory(projectDirectory, workDirectory);
                return resolve();
              });
          } else {
            self.watchProjectDirectory(projectDirectory, workDirectory);
          }
        }
      }
      return resolve();
    });
  },
  doLint(editorFilePath, projectDirectory, editor) {
    const self = this;
    return new Promise((resolve) => {
      if (isASourceDirectoryOutsideProjectDirectory(projectDirectory)) {
        return resolve([]);
      }

      this.maybeCopyProjectToWorkDirectory(projectDirectory)
        .then(() => {
          if (atom.config.get('linter-elm-make.lintOnTheFly')) {
            // Lint on the fly.
            if (!self.workDirectories[projectDirectory]) {
              // Create a temporary directory for the project.
              const workDirectory = tmp.dirSync({prefix: 'linter-elm-make'}).name;
              devLog('Created temporary work directory - ' + workDirectory + ' -> ' + projectDirectory, 'green');
              self.workDirectories[projectDirectory] = workDirectory;
              self.copyProjectToWorkDirectory(projectDirectory, workDirectory)
                .then(() => {
                  self.watchProjectDirectory(projectDirectory, workDirectory);
                  return resolve(self.compileInWorkDirectory(editorFilePath, self.workDirectories[projectDirectory], editor, projectDirectory));
                });
            } else {
              return resolve(self.compileInWorkDirectory(editorFilePath, self.workDirectories[projectDirectory], editor, projectDirectory));
            }
          } else {
            // Lint on save.
            const workDirectory = self.workDirectories[projectDirectory] || projectDirectory;
            if (atom.config.get('linter-elm-make.alwaysCompileMain')) {
              return resolve(self.compileMainFiles(editorFilePath, projectDirectory, workDirectory, editor, (mainFilePath) => mainFilePath));
            } else {
              // Compile active file.
              return resolve(self.executeElmMake(editorFilePath, editorFilePath, workDirectory, editor, projectDirectory));
            }
          }
        });
    });
  },
  copyProjectToWorkDirectory(projectDirectory, workDirectory, options) {
    const self = this;
    return new Promise((resolve) => {
      atom.notifications.addInfo('Copying project files to work directory `' + workDirectory + '`...', {});
      devLog('Syncing work directory with project directory - ' + projectDirectory + ' -> ' + workDirectory);
      // Use `setTimeout` to show the above notification immediately.
      setTimeout(() => {
        if (options && options.deleteSourceDirectoriesInWorkDirectory) {
          self.deleteSourceDirectoriesInWorkDirectory(projectDirectory, workDirectory);
        }
        // Recursively copy source directories, `elm-package.json`, and `elm-stuff` from project directory to work directory.
        // Initial linting might take time depending on the project directory size.
        const copyOptions = {
          preserveTimestamps: true
        };
        // Copy `elm-package.json` to work directory.
        const elmPackageJsonFilePath = path.join(projectDirectory, 'elm-package.json');
        fs.copySync(elmPackageJsonFilePath, path.join(workDirectory, 'elm-package.json'), copyOptions);
        // Copy `elm-stuff` to work directory.
        // Assumes that work directory is not inside `elm-stuff`.
        const elmStuffFilePath = path.join(projectDirectory, 'elm-stuff');
        if (fs.existsSync(elmStuffFilePath)) {
          fs.copySync(elmStuffFilePath, path.join(workDirectory, 'elm-stuff'), copyOptions);
        }
        // Copy source directories to work directory.
        // Be careful with source directories outside of the project directory (e.g. "../../src").
        let json = fs.readJsonSync(path.join(projectDirectory, 'elm-package.json'), {throws: false});
        if (!json) {
          return resolve();
        }
        // TODO Check if `sourceDirectories` is an array of strings.
        const sourceDirectories = json['source-directories'];
        if (sourceDirectories && sourceDirectories.length > 0) {
          const copyOptionsWithElmFilter = JSON.parse(JSON.stringify(copyOptions));
          copyOptionsWithElmFilter.filter = (filePath) => {
            return path.extname(filePath) === '.elm';
          };
          const copyOptionsWithElmAndDirectoryFilter = JSON.parse(JSON.stringify(copyOptions));
          copyOptionsWithElmAndDirectoryFilter.filter = (filePath) => {
            return !filePath.startsWith(workDirectory + path.sep) && copyOptionsWithElmFilter.filter(filePath);
          };
          // Filter out child source directories (i.e. if a source directory is inside another, do not copy files for that source directory anymore).
          const allSourceDirectories = sourceDirectories.map(x => path.resolve(projectDirectory, x));
          const parentSourceDirectories =
            new Set(
              allSourceDirectories
                .filter(x => !allSourceDirectories.some(y => x != y && x.startsWith(y + path.sep))));

          parentSourceDirectories.forEach((projectSourceDirectory) => {
            const workSourceDirectory = projectSourceDirectory.replace(projectDirectory, workDirectory);
            if (fs.existsSync(projectSourceDirectory)) {
              devLog('> Copying project source directory to work directory - ' + projectSourceDirectory + ' -> ' + workSourceDirectory);
              // If work directory is inside project directory...
              if ((workDirectory + path.sep).startsWith(projectDirectory)) {
                const projectFilePaths = readDir.readSync(projectSourceDirectory, null, readDir.ABSOLUTE_PATHS);
                projectFilePaths.forEach((projectFilePath) => {
                  const workFilePath = projectFilePath.replace(projectDirectory, workDirectory);
                  fs.copySync(projectFilePath, workFilePath, copyOptionsWithElmAndDirectoryFilter);
                });
              } else {
                fs.copySync(projectSourceDirectory, workSourceDirectory, copyOptionsWithElmFilter);
              }
              if (atom.config.get('linter-elm-make.logDebugMessages')) {
                if (fs.existsSync(workSourceDirectory)) {
                  devLog('> Copied project source directory to work directory - ' + projectSourceDirectory + ' -> ' + workSourceDirectory, 'green');
                }
              }
            }
          });
        }
        atom.notifications.addSuccess('Copied project files to work directory `' + workDirectory + '`', {});
        devLog('Synched work directory with project directory - ' + projectDirectory + ' -> ' + workDirectory, 'green');
        return resolve();
      }, 0);
    });
  },
  watchProjectDirectory(projectDirectory, workDirectory) {
    // Watch project directory for file changes.
    let ignored = [];
    if ((workDirectory + path.sep).startsWith(projectDirectory)) {
      ignored.push(workDirectory.replace(projectDirectory + path.sep, '') + path.sep + '**');
    }
    // TODO Only watch source directories.
    let watcher = chokidar.watch(['elm-package.json', 'elm-stuff/exact-dependencies.json', 'elm-stuff/packages/**', '**/*.elm'], {
      cwd: projectDirectory,
      usePolling: true, useFsEvents: true, persistent: true,
      ignored: ignored, ignoreInitial: true,
      followSymlinks: false, interval: 100, alwaysStat: false, depth: undefined,
      awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
      ignorePermissionErrors: false, atomic: false
    });
    this.watchers[projectDirectory] = watcher;
    watcher.on('add', (filename) => {
      const filePath = path.join(projectDirectory, filename);
      if (!filePath.startsWith(workDirectory + path.sep) &&
        (filePath === path.join(projectDirectory, 'elm-package.json') ||
         filePath === path.join(projectDirectory, 'elm-stuff', 'exact-dependencies.json') ||
         filePath.startsWith(path.join(projectDirectory, 'elm-stuff', 'packages')) ||
         path.extname(filePath) === '.elm')) {
         devLog('`add` detected - ' + filePath);
        fs.copySync(filePath, path.join(workDirectory, filename));
      }
    });
    // watcher.on('addDir', (filename) => {
    //   const filePath = path.join(projectDirectory, filename);
    //   if (!filePath.startsWith(workDirectory + path.sep) &&
    //     filePath.startsWith(path.join(projectDirectory, 'elm-stuff', 'packages'))) {
    //     if (atom.config.get('linter-elm-make.logDebugMessages')) {
    //       devLog('`addDir` detected - ' + filePath);
    //     }
    //     fs.mkdirsSync(path.join(workDirectory, filename));
    //   }
    // });
    watcher.on('unlink', (filename) => {
      const filePath = path.join(projectDirectory, filename);
      devLog('`unlink` detected - ' + filePath);
      if (!filePath.startsWith(workDirectory + path.sep)) {
        fs.removeSync(path.join(workDirectory, filename));
        // TODO Only force lint if active editor is inside `projectDirectory`.
        if (atom.config.get('linter-elm-make.lintOnTheFly')) {
          forceLintActiveElmEditor();
        }
      }
    });
    watcher.on('unlinkDir', (dirname) => {
      const dirPath = path.join(projectDirectory, dirname);
      devLog('`unlinkDir` detected - ' + dirPath);
      if (!dirPath.startsWith(workDirectory + path.sep)) {
        fs.removeSync(path.join(workDirectory, dirname));
      }
    });
    watcher.on('change', (filename) => {
      const filePath = path.join(projectDirectory, filename);
      if (!filePath.startsWith(workDirectory + path.sep)) {
        if (filePath === path.join(projectDirectory, 'elm-package.json') ||
            filePath === path.join(projectDirectory, 'elm-stuff', 'exact-dependencies.json')) {
         devLog('`change` detected - ' + filename);

        if (!isASourceDirectoryOutsideProjectDirectory(projectDirectory)) {
          // TODO Only do `copyProjectToWorkDirectory` if the value of "source-directories" was changed.
          this.copyProjectToWorkDirectory(projectDirectory, workDirectory, {deleteSourceDirectoriesInWorkDirectory: true})
            .then(() => {
              const workFilePath = path.join(workDirectory, filePath.replace(projectDirectory, ''));
              fs.writeFileSync(workFilePath, fs.readFileSync(filePath).toString());
              if (filePath === path.join(projectDirectory, 'elm-package.json')) {
                forceLintActiveElmEditor();
              }
            });
        }

        } else if (atom.config.get('linter-elm-make.lintOnTheFly')) {
          const workDirectory = this.workDirectories[projectDirectory];
          if (workDirectory) {
            const workFilePath = path.join(workDirectory, filePath.replace(projectDirectory, ''));
            if (fs.existsSync(workFilePath)) {
              // Ignore if work file does not exist, yet.
              fs.writeFileSync(workFilePath, fs.readFileSync(filePath).toString());
            }
          }
        }
      }
    });
    // TODO Handle when projectDirectory gets renamed or deleted.
    // TODO When to close watcher, delete temporary directory, and delete self.workDirectories[projectDirectory]?
  },
  deleteSourceDirectoriesInWorkDirectory(projectDirectory, workDirectory) {
    let json = fs.readJsonSync(path.join(projectDirectory, 'elm-package.json'), {throws: false});
    if (json) {
      const sourceDirectories = json['source-directories'];
      // TODO Check if `sourceDirectories` is an array of strings.
      if (sourceDirectories) {
        sourceDirectories.forEach((sourceDirectory) => {
          const workDirectorySourceDirectory = path.resolve(workDirectory, sourceDirectory);
          fs.removeSync(workDirectorySourceDirectory);
          devLog('> Deleted source directory in work directory - ' + workDirectorySourceDirectory, 'green');
        });
      }
    }
  },
  provideGetWorkDirectory() {
    const self = this;
    return (filePath) => {
      const projectDirectory = lookupElmPackage(path.dirname(filePath));
      if (projectDirectory === null) {
        return null;
      }
      return self.workDirectories[projectDirectory] || projectDirectory;
    };
  },
  compileInWorkDirectory(editorFilePath, workDirectory, editor, projectDirectory) {
    const workFilePath = path.join(workDirectory, editorFilePath.replace(projectDirectory, ''));
    // Write contents of active editor to associated compile file.
    if (fs.existsSync(workFilePath)) {
      // Ignore if work file does not exist, yet.
      fs.writeFileSync(workFilePath, editor.getText());
    }
    if (atom.config.get('linter-elm-make.alwaysCompileMain')) {
      return this.compileMainFiles(editorFilePath, projectDirectory, workDirectory, editor, (mainFilePath) => mainFilePath.replace(projectDirectory, workDirectory));
    } else {
      // Compile active file.
      return this.executeElmMake(editorFilePath, workFilePath, workDirectory, editor, projectDirectory);
    }
  },
  compileMainFiles(editorFilePath, projectDirectory, cwd, editor, mainFilePathTransformFunction) {
    const mainFilePaths = this.getMainFilePaths(projectDirectory);
    if (mainFilePaths) {
      // Compile the main files, then combine the linting results.
      const elmMakePromises = mainFilePaths.map((mainFilePath) => {
        return this.executeElmMake(editorFilePath, mainFilePathTransformFunction(mainFilePath), cwd, editor, projectDirectory);
      });
      return Promise.all(elmMakePromises).then((results) => {
        return _.flatten(results, true);
      });
    } else {
      return [];
    }
  },
  getMainFilePaths(projectDirectory) {
    const elmPackageJsonFilePath = path.join(projectDirectory, 'elm-package.json');
    if (!fs.existsSync(elmPackageJsonFilePath)) {
      return null;
    }
    const elmPackageJson = fs.readJsonSync(elmPackageJsonFilePath, {throws: false});
    if (!elmPackageJson) {
      return null;
    }
    const linterElmMakeJsonFilePath = path.join(projectDirectory, 'linter-elm-make.json');
    let linterElmMakeJson;
    if (fs.existsSync(linterElmMakeJsonFilePath)) {
      linterElmMakeJson = fs.readJsonSync(linterElmMakeJsonFilePath, {throws: false});
    }
    const mainPaths = linterElmMakeJson && linterElmMakeJson.mainPaths;
    const errorDetail =
      'Note that "Always Compile Main" is ON.  You can do one of the following:\n' +
      ' - Turn off "Always Compile Main" in the package settings to compile the active file instead.\n' +
      ' - Set the main paths of the project using `Linter Elm Make: Set Main Paths`. (Saves the main paths to `linter-elm-make.json`.)\n' +
      ' - Put a `Main.elm` file in at least one of the source directories.';
    // If `mainPaths` exists, use that.
    if (mainPaths && mainPaths.length > 0) {
      const BreakException = {};
      try {
        return mainPaths.map((mainPath) => {
          const mainFilePath = path.resolve(projectDirectory, mainPath);
          if (!fs.existsSync(mainFilePath)) {
            atom.notifications.addError('The main path `' + mainPath + '` does not exist', {
              detail: errorDetail,
              dismissable: true
            });
            throw BreakException;
          }
          const isMainPathInsideSourceDirectory = (sourceDirectories, filePath) => {
            // TODO Check if `sourceDirectories` is an array of strings.
            if (sourceDirectories) {
              for (let i in sourceDirectories) {
                const sourceDirectory = sourceDirectories[i];
                if (filePath.startsWith(path.resolve(projectDirectory, sourceDirectory) + path.sep)) {
                  return true;
                }
              }
            }
            return false;
          };
          if (!isMainPathInsideSourceDirectory(elmPackageJson['source-directories'], mainFilePath)) {
            atom.notifications.addError('The main path `' + mainPath + '` is not inside a source directory', {
              detail: errorDetail,
              dismissable: true
            });
            throw BreakException;
          }
          return mainFilePath;
        });
      } catch(e) {
        if (e !== BreakException) {
          return null;
        }
      }
    } else {
      // Else, look for `Main.elm` files in the source directories.
      // TODO Check if `sourceDirectories` is an array of strings.
      const sourceDirectories = elmPackageJson['source-directories'];
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
          atom.notifications.addError('Could not find `Main.elm` in `[' + sourceDirectories.map((directory) => '"' + directory + '"').join(', ') + ']`', {
            detail: errorDetail,
            dismissable: true
          });
        }
      }
    }
    return null;
  },
  consumeStatusBar(statusBar) {
    if (!statusBar) return;

    this.statusBar = statusBar;
    this.quickFixesIndicator = this.statusBar.addLeftTile({
      item: createQuickFixesIndicator(),
      priority: 1
    });
  },
  executeElmMake(editorFilePath, inputFilePath, cwd, editor, projectDirectory) {
    const executablePath = atom.config.get('linter-elm-make.elmMakeExecutablePath');

    let progressIndicator;
    if (this.statusBar) {
      progressIndicator = this.statusBar.addLeftTile({
        item: createProgressIndicator(),
        priority: 1
      });
    }

    let args = [inputFilePath, '--report=json', '--output=/dev/null', '--yes'];
    if (atom.config.get('linter-elm-make.reportWarnings')) {
      args.push('--warn');
    }
    let self = this;
    devLog('Executing ' + executablePath + ' ' + args.join(' ') + ' (initiated from ' + editorFilePath + ')');
    return atomLinter.exec(executablePath, args, {
      stream: 'both', // stdout and stderr
      cwd: cwd,
      env: process.env
    })
    .then(data => {
      let result;
      // filter haskell memory error messages
      // see https://ghc.haskell.org/trac/ghc/ticket/12495
      data.stderr = data.stderr.split("\n").filter((line) => line !== "elm-make: unable to decommit memory: Invalid argument").join("\n");
      if (data.stderr === '') {
        result = self.parseStdout(data.stdout, editorFilePath, cwd, editor, projectDirectory);
      } else {
        result = self.parseStderr(data.stderr, editorFilePath);
      }
      progressIndicator && progressIndicator.destroy();
      self.updateLinterUI();
      return result;
    })
    .catch(errorMessage => {
      atom.notifications.addError('Failed to run ' + executablePath, {
        detail: errorMessage,
        dismissable: true
      });
      progressIndicator && progressIndicator.destroy();
      self.updateLinterUI();
      return [];
    });
  },
  parseStdout(stdout, editorFilePath, cwd, editor, projectDirectory) {
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
          if (problem.file.startsWith('.' + path.sep)) {
            // `problem.file` has a relative path (e.g. `././A.elm`) . Convert to absolute.
            filePath = path.join(cwd, path.normalize(problem.file));
          }
          if (cwd !== projectDirectory) {
            // problem.file is a work file
            filePath = filePath.replace(cwd, projectDirectory);
          }
          // HACK: Add an anchor so that we can scroll the relevant message into view when the cursor position changes.
          return {
            type: problem.type,
            html: `<a class='${getAnchorForMessage(filePath, range)}'></a>${colorize(_.escape(problem.overview))}<br/><br/>${colorize(_.escape(problem.details).split('\n').join('<br/>&nbsp;'))}`,
            filePath: filePath,
            range: range,
            problem: problem
          };
        });
      }
    });
    const problemsWithoutWorkFiles = problemsByLine.map((problems) => {
      return problems.filter((problem) => {
        // Filter out work files.
        return problem.filePath.startsWith(projectDirectory);
      });
    });
    const allProblems = _.flatten(problemsWithoutWorkFiles, true);
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
    this.computeQuickFixesForEditor(editor);
    return allProblems;
  },
  parseStderr(stderr, editorFilePath) {
    const stderrLines = stderr.split('\n');
    let lineNumber = 0;
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
        html: `${stderrLines.map((line) => { return _.escape(line); }).join('<br/>')}`,
        filePath: editorFilePath,
        range: [
          [lineNumber, 0],
          [lineNumber, 0]
        ] // TODO search for invalid import
      }
    ];
  },
  computeQuickFixesForEditor(editor) {
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
  getFixesAtCursorPosition() {
    const editor = atom.workspace.getActiveTextEditor();
    if (!isElmEditor(editor)) {
      return null;
    }
    const position = editor.getLastCursor().getBufferPosition();
    // Look for fixes for the issue at cursor position.
    let fixesForPosition = null;
    const quickFixes = this.quickFixes[editor.getPath()] || this.computeQuickFixesForEditor(editor);
    if (quickFixes) {
      _.find(quickFixes, ({range, fixes}) => {
        if (range.containsPoint(position)) {
          fixesForPosition = {range, fixes};
          return true;
        }
        return false;
      });
    }
    return fixesForPosition;
  },
  updateLinterUI() {
    if (this.updateLinterUIDebouncer) {
      clearTimeout(this.updateLinterUIDebouncer);
      this.updateLinterUIDebouncer = null;
    }
    this.updateLinterUIDebouncer =
      setTimeout(() => {
        this.updateQuickFixesIndicatorDisplay();
        this.scrollProblemAtCursorIntoView();
    }, 300);
  },
  updateQuickFixesIndicatorDisplay() {
    if (this.quickFixesIndicator) {
      const fixesForCursorPosition = this.getFixesAtCursorPosition();
      this.quickFixesIndicator.item.innerHTML = fixesForCursorPosition ? 'Quick Fixes: ' + fixesForCursorPosition.fixes.length : '';
    }
  },
  scrollProblemAtCursorIntoView() {
    if (atom.config.get('linter-elm-make.autoscrollIssueIntoView')) {
      let linterPanel = document.getElementsByTagName('linter-panel');
      if (linterPanel && linterPanel.length > 0) {
        linterPanel = linterPanel[0];
        if (this.prevProblemAnchor) {
          this.prevProblemAnchor.parentNode.parentNode.parentNode.className = 'linter-elm-make-issue';
        }
        const problem = this.getProblemAtCursorPosition();
        if (problem) {
          let problemAnchor = linterPanel.getElementsByClassName(getAnchorForMessage(problem.filePath, problem.range));
          if (problemAnchor && problemAnchor.length > 0) {
            problemAnchor = problemAnchor[0];
            problemAnchor.scrollIntoView();
            problemAnchor.parentNode.parentNode.parentNode.className = 'linter-elm-make-issue-selected';
            this.prevProblemAnchor = problemAnchor;
          }
        } else {
          this.prevProblemAnchor = null;
        }
      }
    }
  },
  getProblemAtCursorPosition() {
    const editor = atom.workspace.getActiveTextEditor();
    if (!isElmEditor(editor)) {
      return null;
    }
    const position = editor.getLastCursor().getBufferPosition();
    // Look for problem at cursor position.
    let problem = null;
    const problems = this.problems[editor.getPath()];
    if (problems) {
      _.find(problems, ({range, filePath}) => {
        if (range.containsPoint(position)) {
          problem = {range, filePath};
          return true;
        }
        return false;
      });
    }
    return problem;
  }
};

function createProgressIndicator() {
  const result = document.createElement("div");
  result.classList.add("inline-block");
  result.classList.add("icon-ellipsis");
  result.innerHTML = "Linting...";
  return result;
}

function createQuickFixesIndicator() {
  const result = document.createElement("div");
  result.classList.add("inline-block");
  return result;
}

function lookupElmPackage(directory) {
  if (fs.existsSync(path.join(directory, 'elm-package.json'))) {
    return directory;
  } else {
    const parentDirectory = path.join(directory, "..");
    if (parentDirectory === directory) {
      atom.notifications.addError('No `elm-package.json` beneath or above the edited file', {
        detail: 'You can generate an `elm-package.json` file by running `elm-package install` from the command line.',
        dismissable: true
      });
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
    return atomLinter.exec(executablePath, ['--help'], {
      stream: 'stdout',
      cwd: projectDirectory,
      env: process.env
    })
    .then(data => {
      let elmPlatformVersion = data.split('\n')[0].match(/\(Elm Platform (.*)\)/)[1];
      let json = fs.readJsonSync(path.join(projectDirectory, 'elm-package.json'), {throws: false});
      if (json) {
        if (json.repository && json.version) {
          const matches = json.repository.match(/^(.+)\/(.+)\/(.+)\.git$/);
          const user = (matches && matches.length > 2 && matches[2]) || null;
          const project = (matches && matches.length > 3 && matches[3]) || null;
          if (user && project) {
            return path.join(projectDirectory, 'elm-stuff', 'build-artifacts', elmPlatformVersion, user, project, json.version);
          } else {
            atom.notifications.addError('Could not determine the value of "user" and/or "project"', {dismissable: true});
          }
        } else {
          atom.notifications.addError('Field "repository" and/or "version" not found in elm-package.json', {dismissable: true});
        }
      } else {
        atom.notifications.addError('Error parsing elm-package.json', {dismissable: true});
      }
    })
    .catch(errorMessage => {
      atom.notifications.addError('Failed to run ' + executablePath, {
        detail: errorMessage,
        dismissable: true
      });
    });
  }
  return null;
}

function isASourceDirectoryOutsideProjectDirectory(projectDirectory) {
  const configWorkDirectory = atom.config.get('linter-elm-make.workDirectory');
  if (!atom.config.get('linter-elm-make.lintOnTheFly') && (!configWorkDirectory || configWorkDirectory.trim() === '')) {
    return false;
  }
  // If `Lint On The Fly` is enabled or `Work Directory` is set, it's not safe to have source directories outside of the project directory (e.g. "../src") since files might be modified/deleted.
  // Example: If the temporary work directory is `/tmp/aabbcc` and "source-directories" is ["../../"], that maps to the root directory!
  let json = fs.readJsonSync(path.join(projectDirectory, 'elm-package.json'), {throws: false});
  if (!json) {
    return true;
  }
  const sourceDirectories = json['source-directories'];
  if (!sourceDirectories) {
    return true;
  }
  const hasOutsideSource = sourceDirectories.find((sourceDirectory) => {
    const resolved = path.resolve(projectDirectory, sourceDirectory);
    return resolved !== projectDirectory && !resolved.startsWith(projectDirectory + path.sep);
  });
  if (hasOutsideSource) {
    atom.notifications.addError('A source directory is outside the project directory', {
      detail:
      'If `Lint On The Fly` is enabled or `Work Directory` is set, it is not safe to have source directories outside the project directory (e.g. "../src").\n' +
      'You can do one of the following:\n' +
      ' - Turn off "Lint On The Fly" in the package settings.\n' +
      ' - Unset "Work Directory" in the package settings.\n' +
      ' - Modify the "source-directories" field in the `elm-package.json` of the project to remove paths outside the project directory.',
      dismissable: true
    });
    return true;
  }
  return false;
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

function refreshLintResultsOfActiveElmEditor() {
  const editor = atom.workspace.getActiveTextEditor();
  if (isElmEditor(editor)) {
    // Toggle linter off then on again to refresh the lint results.
    [1, 2].forEach(() => {
      atom.commands.dispatch(atom.views.getView(editor), 'linter:toggle');
    });
  }
}

function isElmEditor(editor) {
  return editor && editor.getPath && editor.getPath() && path.extname(editor.getPath()) === '.elm';
}

// TODO: Tests.
function getFixesForProblem(problem, rangeText) {
  let matches = null;
  switch (problem.tag) {
    case 'NAMING ERROR':
      matches = problem.details.match(/^No module called `(.*)` has been imported./);
      if (matches && matches.length > 1) {
        const importFix = [{
          type: 'Add import',
          text: 'import ' + matches[1]
        }];
        const suggestionFixes = (problem.suggestions || []).map((suggestion) => {
          return {
            type: 'Replace with',
            text: rangeText.replace(matches[1], suggestion)
          };
        });
        return importFix.concat(suggestionFixes);
      }
      matches = problem.details.match(/^The qualifier `(.*)` is not in scope\./);
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
      matches = problem.overview.match(/^Cannot find (?:variable|type|pattern) `(.*)`/);
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
    default:
      return null;
  }
}

// TODO: Tests.
function fixProblem(editor, range, fix) {
  switch (fix.type) {
    case 'Replace with':
      editor.setTextInBufferRange(fix.range ? fix.range : range, fix.text);
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
  }
}

function getAnchorForMessage(filePath, range) {
  return 'linter-elm-make://' + filePath + ':' + range.start.row + ',' + range.start.column;
}

function devLog(msg, color) {
  if (atom.config.get('linter-elm-make.logDebugMessages')) {
    if (color) {
      console.log('[linter-elm-make] %c' + msg, 'color:' + color + ';');
    } else {
      console.log('[linter-elm-make] ' + msg);
    }
  }
}
