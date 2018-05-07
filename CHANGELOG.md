## 0.28.5
* Fix issue about inferred type markers not being removed (#173).  Thanks to @3nigm4 for reporting!

## 0.28.4
* Fix #180.  Thanks to @mm-tfx for reporting and to @Arcanemagus for the fix!
* Do not process files when editing remotely via Atom Teletype (for now).

## 0.28.3
* Fix `Define top-level` bug.

## 0.28.2
* Fix #175.  Thanks to @adam-becker for reporting!
* Fix #176.  Thanks to @hcphoenix for reporting!

## 0.28.1
* Revert to old behavior of searching for project directory.

## 0.28.0
* Add `Linter Elm Make: Lint` command (#169).  Thanks to @anagrius for the suggestion!

## 0.27.2
* If the `.elm` file is not in an Atom project, search for `elm-package.json` until we reach the root.

## 0.27.1
* Fix bug introduced by previous version.  Thanks to @raffomania for reporting and debugging!

## 0.27.0
* When searching for the `elm-package.json` for an `.elm` file, stop when we reach the root of the Atom project.
<!-- * Add `Search for symbols matching type` quick fix. -->
* Add `Convert to port module` quick fix.
* Make urls work inside Datatips.

## 0.26.2
* Allow defining top-level in another directory (e.g. Other.Another.foo).

## 0.26.1
* Add documentation and screenshot for `Use Datatips`.

## 0.26.0
* Fix bug regarding "++" quick fixes.
* Add `Use Datatips` option.
* Add `Run elm package install` quick fix (when elm-stuff is not found).
* Add `Define top-level` quick fix (when variable or type is not found).
* Add `Change type annotation` quick fix.

## 0.25.2
* Reactivate pane after applying quick fix (when using `atom-ide-ui`).

## 0.25.1
* After applying a quick fix, do not clear the other fixes when not linting on the fly.

## 0.25.0
* Add code actions integration (for `atom-ide-ui`).

## 0.24.4
* Add `atom-ide-ui` integration.  Thanks to @dtinth for reporting!

## 0.24.3
* Fix #152.  Thanks to @christianbradley for reporting!
* Fix minor issues.

## 0.24.2
* Use [`atom-linter`](https://www.npmjs.com/package/atom-linter)'s `uniqueKey` in lieu of the lint task queue.
* If the text range of an issue is empty (start point is equal to end point), include the next character.
* Fix styling issues.

## 0.24.1
* Fix `Timeout` setting issue.  Thanks to @MethodGrab!

## 0.24.0
* Add `Timeout` setting.  Thanks to @raffomania for reporting and @MethodGrab for the PR!

## 0.23.8
* Fix "Incompatible Packages" issue.

## 0.23.7
* Copy native modules to the work directory when `Lint On The Fly` is enabled (#122).  Thanks to @iteloo for reporting and to @QuinnFreedman for the fix!
* Upgrade package dependencies.

## 0.23.6
* Use [atom-package-deps](https://www.npmjs.com/package/atom-package-deps) to automatically install the minimum required packages (#89).

## 0.23.5
* Fix minor styling issue.

## 0.23.4
* Fix integration with [Nuclide](https://atom.io/packages/nuclide) diagnostics (#88). Thanks to @denisw for reporting!

## 0.23.3
* Remove the hacky `Auto Scroll Issue Into View` option.  Check out the `Tooltip Follows` option of `linter-ui-default` instead.

## 0.23.2
* Fix tooltip background color for warnings.

## 0.23.1
* Fix issue with the number of quick fixes (near tooltip) not showing in Linter v2.
* Adjust placement of "Linting..." and "Quick Fixes" indicators (status bar).

## 0.23.0
* Fix styling issues when using Linter v2.
* Fix "Add import" quick fix bug (#133).  Thanks to @pacbeckh for reporting!

## 0.22.6
* Styling fixes.

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
