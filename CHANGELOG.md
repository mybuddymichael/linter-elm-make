## 0.22.5
* Make `Set Main Paths` work again (#130).  Thanks to @raffomania for reporting!
* Styling fixes.

## 0.22.4
* Fix issue where the text of the quick fixes tooltip is not visible when using some UI themes.  Thanks to @AntouanK for reporting!

## 0.22.3
* Better lint task queuing.

## 0.22.2
* Remove "Elm" label in linter panel and linter tooltip to minimize space requirement.
* Made linter tooltip a bit translucent to see a semblance of the code underneath.

## 0.22.1
* Change quick fix icon to the standard light bulb.
* Move quick fix icon to the left of linter tooltip.

## 0.22.0
* Add `Add missing patterns` quick fix.
* Add `Fix module name` quick fix.
* Show number of quick fixes with the linter tooltip.
* More styling.

## 0.21.1
* Fix `Auto Scroll Issue Into View` regression bug.
* Escape links in messages.
* More styling.

## 0.21.0
* Change inline tooltip style to match linter panel.
* Fix bug where inferred type annotations are not properly removed.
* More styling.

## 0.20.0
* Add styling and diffs to linter panel and inline tooltips.
* Highlight problem subregion if available.
* Make `Auto Scroll Issue Into View` choose the most specific problem range containing cursor position, not the first one.

## 0.19.0
* Add `Show Inferred Type Annotations` option.

## 0.18.5
* Fix wrong file extension for intentions screen capture.

## 0.18.4
* Allow integration with the [Intentions](https://atom.io/packages/intentions) package.

## 0.18.3
* Put a try/catch when checking if a file exists.

## 0.18.2
* Add quick fix for "The record fields do not match up".

## 0.18.1
* Fix errors when status-bar isn't available.  Thanks, @ream88!

## 0.18.0
* Add auto import and syntax error quick fixes.

## 0.17.8
* Only copy `.elm` files, `elm-package.json`, and `elm-stuff` of the project directory to the work directory.
* If `Lint On The Fly` is enabled, force a lint when a `.elm` file is deleted.

## 0.17.7
* If `Lint On The Fly` is enabled or `Work Directory` is set, do not lint if there is a source directory outside the project directory.

## 0.17.6
* Fix \#93.

## 0.17.5
* Fix `elm-format` integration bug.

## 0.17.4
* Allow integration with [Nuclide](https://atom.io/packages/nuclide) diagnostics.

## 0.17.3
* Filter out `elm-make: unable to decommit memory: Invalid argument` messages.  Thanks, @despairblue!

## 0.17.2
* Refactor filter out child source directories.  Thanks, @Leonqn!

## 0.17.1
* Fix issue related to syncing work directory with project directory.

## 0.17.0
* Add `Log Debug Messages` option.

## 0.16.0
* Add `Auto Scroll Issue Into View` option.
* Escape html in issue messages.

## 0.15.0
* Add "Quick Fixes" indicator in the status bar.
* Add lint task queue to prevent race conditions.
* Update `atom-linter` version.
* If a source directory is inside another, do not copy files for that source directory anymore (to the work directory).

## 0.14.0
* Undo 0.13.3!  Run a separate `elm-make` process again for each main path because there is an issue with files having the same module name.
* Save `mainPaths` to `linter-elm-make.json` instead of `elm-package.json`.
* Fix wrong links in README.md.

## 0.13.3
* Run only 1 `elm-make` process for multiple main paths.

## 0.13.2
* Add notification when copying files to work directory.

## 0.13.0
* Only copy source directory files to the work directory.
* Make `Clear Project Build Artifacts` work in Windows.

## 0.12.0
* Remove `Linter Elm Make: Set Main Path`.
* Add `Linter Elm Make: Set Main Paths` (allow more than 1 main path).

## 0.11.1
* Fix `Clear Project Build Artifacts` error when build artifacts directory does not exist.

## 0.11.0
* Add `Work Directory` option.

## 0.10.1
* Add useful error details.
* Update `CHANGELOG.md`.

## 0.10.0
* Add `Linter Elm Make: Set Main Path`.
* Set `Always Compile Main` default to `false`.

## 0.9.0
* On-the-fly linting 2.0.

## 0.8.0
* Add `Always Compile Main` option.

## 0.7.0
* Add option to ignore `elm-make` warnings.

## 0.6.0
* On-the-fly linting.

## 0.5.0
* Add `Linter Elm Make: Quick Fix` and `Linter Elm Make: Quick Fix All`.

## 0.4.0
* Various fixes.

## 0.3.0
* Don't output a file on compilation.

## 0.2.0
* Use JavaScript instead of CoffeeScript.
* Warn the user if they're missing prerequisite packages.

## 0.1.1
* Update the README to credit `linter-hlint`.
* Update the README to note that one needs the `language-elm` package.
* Remove some unnecessary startup code.

## 0.1.0 - First Release
* Every feature added
* Every bug fixed
