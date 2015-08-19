{BufferedProcess, CompositeDisposable} = require 'atom'

module.exports =
  config:
    elmMakeExecutablePath:
      title: 'The elm-make executable path.'
      type: 'string'
      default: 'elm-make'

  provideLinter: ->
    proc = process
    provider =
      grammarScopes: ['source.elm']
      scope: 'file'
      lintOnFly: true
      lint: (textEditor) =>
        return new Promise (resolve, reject) =>
          filePath = textEditor.getPath()
          lines = []
          executablePath = atom.config.get 'linter-elm-make.elmMakeExecutablePath'
          options =
            cwd: atom.project.getPaths()[0]
            env: proc.env
          process = new BufferedProcess
            command: executablePath
            args: [filePath, '--warn', '--report=json']
            options: options
            stdout: (data) ->
              lines.push(data)
            exit: (code) =>
              text = lines[0]
              json = try JSON.parse(text.slice(0, text.indexOf("\n")))
              console.log json if atom.inDevMode()
              return resolve [] unless json?
              resolve json.map (error) ->
                type: error.type
                html: "#{error.overview}<br/><br/>#{error.details.split('\n').join('<br/>&nbsp;')}"
                filePath: error.file or filePath
                range: [
                  [error.region.start.line - 1, error.region.start.column - 1],
                  [error.region.end.line - 1, error.region.end.column - 1]
                ]

          process.onWillThrowError ({error,handle}) ->
            atom.notifications.addError "Failed to run #{executablePath}",
              detail: "#{error.message}"
              dismissable: true
            handle()
            resolve []
