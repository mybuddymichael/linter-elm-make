# linter-elm-make

Lint your Elm files in Atom with [linter](https://github.com/atom-community/linter) and `elm-make`.

## Installation

1. [Install `elm`](http://elm-lang.org/install).
1. `$ apm install linter`
1. `$ apm install language-elm`
1. `$ apm install linter-elm-make`
1. `$ which elm-make` and set that as your executable path in this installed package's configuration.

## Linting Modes

By default, linting is only done after saving the file.  If you want to lint while typing, check the `Lint On The Fly` option in the package settings.  Also make sure that the `Lint As You Type` option is checked in the [linter](https://github.com/atom-community/linter) package settings.

To always compile `Main.elm` instead of the active file, check the ```Always Compile `Main.elm` `` option.  Take note that if this is enabled, modules unreachable from the main modules will not be linted.

You can also choose `Linter Elm Make: Toggle Lint On The Fly` or `Linter Elm Make: Toggle Always Compile Main` from the command palette to switch between the linting modes.

Invoke `Linter Elm Make: Clear Project Build Artifacts` from the command palette if you want to delete the `*.elmi` and `*.elmo` files of your project (useful when switching linting modes).

![lint-on-fly](https://github.com/mybuddymichael/linter-elm-make/blob/master/images/lint-on-fly.gif?raw=true)

## Quick Fixes

Move your cursor to a problematic text range and choose `Linter Elm Make: Quick Fix` from the command palette to show the possible fixes. Select a fix from the list to apply it to your code.

![quick-fix](https://github.com/mybuddymichael/linter-elm-make/blob/master/images/quick-fix.png?raw=true)

Choosing `Linter Elm Make: Quick Fix All` will fix all the issues in the active text editor. If there is more than one fix for an issue, it will choose the first from the list.

You may also add something like this in your `keymap.cson`:

```
'atom-text-editor:not([mini])[data-grammar^="source elm"]':
  'f6': 'linter-elm-make:quick-fix'
  'shift-f6': 'linter-elm-make:quick-fix-all'

'.linter-elm-make atom-text-editor[mini]':
    'f6': 'core:confirm'
```

## Prior Art

The boilerplate code here is repurposed from [linter-hlint](https://github.com/AtomLinter/linter-hlint). Much thanks to its [contributors](https://github.com/AtomLinter/linter-hlint/graphs/contributors).
