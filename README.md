# linter-elm-make

https://atom.io/packages/linter-elm-make

Lint your Elm files in Atom with [linter](https://atom.io/packages/linter) and `elm-make`.

![diffs](https://github.com/mybuddymichael/linter-elm-make/blob/master/images/diffs.png?raw=true)

## Installation

1. Install [Elm](http://elm-lang.org/install).
1. Install [linter](https://atom.io/packages/linter), [language-elm](https://atom.io/packages/language-elm), and [linter-elm-make](https://atom.io/packages/linter-elm-make) from the Settings view (`Edit` > `Preferences` > `Install`) or by running these from the command line:

  ```
  apm install linter
  apm install language-elm
  apm install linter-elm-make
  ```

  * If you want to use [Nuclide](https://atom.io/packages/nuclide) in lieu of [linter](https://atom.io/packages/linter), check this [compatibility guide](https://nuclide.io/docs/advanced-topics/linter-package-compatibility).

  * You can also use the [Intentions](https://atom.io/packages/intentions) package instead of the default `Quick Fix` UI.

1. Run `which elm-make` (Unix/Linux) or `where.exe elm-make` (Windows) from the command line and set the result as your executable path in this installed package's configuration.

## Configuration

#### `Lint On The Fly`
By default, linting is only done after saving the file.  If you want to lint while typing, turn on the `Lint On The Fly` option in the package settings.  Also make sure that the `Lint As You Type` option is enabled in the [linter](https://atom.io/packages/linter) package settings.

NOTE: Linting on the fly is experimental and currently works by copying the source files to the `Work Directory` (or to a temporary directory if `Work Directory` is blank) and running `elm-make` there.

![lint-on-fly](https://github.com/mybuddymichael/linter-elm-make/blob/master/images/lint-on-fly.gif?raw=true)

#### `Always Compile Main`
If enabled, the main file(s) will always be compiled instead of the active file.  The main files can be set using `Linter Elm Make: Set Main Paths`.  If not set, the linter will look for `Main.elm` files in the source directories.  Take note that if this is enabled, modules unreachable from the main modules will not be linted.  Disabled by default.

#### `Report Warnings`
Show `elm-make` warnings.  Enabled by default.

#### `Show Inferred Type Annotations`
Note: This will only work if `Report Warnings` is also checked.

  * With `Lint On The Fly` disabled:

  ![show-inferred-type-annotations](https://github.com/mybuddymichael/linter-elm-make/blob/master/images/show-inferred-type-annotations.gif?raw=true)

  * With `Lint On The Fly` enabled:

  ![show-inferred-type-annotations-2](https://github.com/mybuddymichael/linter-elm-make/blob/master/images/show-inferred-type-annotations-2.gif?raw=true)

#### `Work Directory`
- If this is not blank, the linter will copy the source files from the project directory into this directory and use this as the working directory for `elm-make`.  This can be an absolute path or relative to the path of `elm-package.json`.

  If `Lint On The Fly` is disabled, this option will prevent the linter from using your project directory's `elm-stuff`.  This can be useful if you're using other tools to build your output files.

- If this is blank and `Lint On The Fly` is enabled, the linter will create a temporary directory before running the first linting process for the project.  It will then copy the source files from the project directory into the temporary directory.  The linter will do all of this again when Atom gets restarted.  Setting the value of `Work Directory` will shorten the duration of the first lint after a restart since the linter does not need to create a temporary directory and copy files anymore.

- If this is blank and `Lint On The Fly` is disabled, the linter will use the project directory as the working directory for `elm-make`.

If this option is not blank, a file watcher will watch the project directory for source file changes and synchronize those with the work directory.

IMPORTANT WARNING: If the current work directory is inside the project directory and you want to change the value of `Work Directory` in the settings, delete the current work directory first!  Else, the linter will consider that directory as part of your project!

If this option makes no sense and/or is confusing, just leave it blank. :)

## Commands

#### `Linter Elm Make: Quick Fix`
Move your cursor to a problematic text range and invoke this command to show the possible fixes. Select a fix from the list to apply it to your code.

![quick-fix](https://github.com/mybuddymichael/linter-elm-make/blob/master/images/quick-fix.png?raw=true)

  * If you have [Intentions](https://atom.io/packages/intentions) installed, you can invoke `Intentions: Show` instead.

  ![quick-fix-intentions](https://github.com/mybuddymichael/linter-elm-make/blob/master/images/quick-fix-intentions.gif?raw=true)

The number of available fixes for a given cursor position is shown with the linter tooltip and in the status bar.

  * Available Quick Fixes
    * Replace with
    * Add type annotation
    * Remove unused import
    * Add import
    * Add missing patterns
    * Fix module name

#### `Linter Elm Make: Quick Fix All`
Fixes all issues in the active text editor in one go. If there is more than one fix for an issue, it will choose the first from the list.

#### `Linter Elm Make: Set Main Paths`
Sets the main paths of the project and saves them to `linter-elm-make.json`.

Example:
```
{
  "mainPaths": ["Todo.elm", "Test.elm"]
}
```
The main paths are only relevant if `Always Compile Main` is enabled.  See [above](#always-compile-main).

#### `Linter Elm Make: Clear Project Build Artifacts`
Deletes the `.elmi` and `.elmo` files in your project's build artifacts directory (e.g. elm-stuff/build-artifacts/0.17.0/user/project/1.0.0).  This is useful after toggling `Lint On The Fly` and/or `Always Compile Main` to prevent confusing lint results.  If using a work directory or temporary directory, the artifact files of that directory will also be deleted.

#### `Linter Elm Make: Toggle Lint On The Fly`

#### `Linter Elm Make: Toggle Always Compile Main`

#### `Linter Elm Make: Toggle Report Warnings`

## Keybindings

Here is an example:

```
'atom-text-editor:not([mini])[data-grammar^="source elm"]':
  'shift-f6': 'linter-elm-make:quick-fix-all'

  # Add this to use the default UI:
  'f6': 'linter-elm-make:quick-fix'

  # Add this instead if you want to use the Intentions UI:
  'f6': 'intentions:show'

'.linter-elm-make atom-text-editor[mini]':
    'f6': 'core:confirm'
```

Add them to your `keymap.cson` or bind them from `Settings` > `Keybindings`.

## Useful [linter](https://atom.io/packages/linter) Commands

#### `Linter: Lint`

#### `Linter: Next Error`

#### `Linter: Previous Error`

#### `Linter: Toggle`

## Prior Art

The boilerplate code here is repurposed from [linter-hlint](https://github.com/AtomLinter/linter-hlint). Much thanks to its [contributors](https://github.com/AtomLinter/linter-hlint/graphs/contributors).
