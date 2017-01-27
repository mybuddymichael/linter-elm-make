'use babel';

export default {
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
    description: 'Always compile the main file(s) instead of the active file.  The main files can be set using `Linter Elm Make: Set Main Paths`.  If not set, the linter will look for `Main.elm` files in the source directories.  Modules unreachable from the main modules will not be linted.',
    type: 'boolean',
    default: false,
    order: 3
  },
  reportWarnings: {
    title: 'Report Warnings',
    description: 'Report `elm-make` warnings.',
    type: 'boolean',
    default: true,
    order: 4
  },
  showInferredTypeAnnotations: {
    title: 'Show Inferred Type Annotations',
    description: 'Note: This will only work if `Report Warnings` is also checked.',
    type: 'boolean',
    default: false,
    order: 5
  },
  workDirectory: {
    title: 'Work Directory',
    description: 'If this is not blank, the linter will copy the source files from the project directory into this directory and use this as the working directory for `elm-make`.  This can be an absolute path or relative to the path of `elm-package.json`.  If this is blank and `Lint On The Fly` is enabled, the linter will create a temporary work directory for the project.  If this is blank and `Lint On The Fly` is disabled, the linter will use the project directory as the working directory for `elm-make`.  IMPORTANT WARNING: If the work directory is inside the project directory and you want to change the value of `Work Directory`, delete the work directory first!  Else, the linter will consider the work directory as part of your project.',
    type: 'string',
    default: '',
    order: 6
  },
  applyStylingToMessages: {
    title: 'Apply Styling To Messages',
    description: 'Whether to apply styling to the messages (such as diffs for types and typos) or use raw text.',
    type: 'boolean',
    default: true,
    order: 7
  },
  autoscrollIssueIntoView: {
    title: 'Auto Scroll Issue Into View',
    description: 'Automatically scroll the linter panel to highlight the issue relevant to the cursor position.',
    type: 'boolean',
    default: false,
    order: 8
  },
  logDebugMessages: {
    title: 'Log Debug Messages',
    description: 'Show debug messages using `console.log`.',
    type: 'boolean',
    default: false,
    order: 9
  }
};
