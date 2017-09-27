'use babel';

import _ from 'underscore';
import helper from './helper';

export default {
  parse(problem, functions) {
    return _.flatten(this.parse1(problem, functions));
  },
  parse1(problem, functions) {
    if (!atom.config.get('linter-elm-make.applyStylingToMessages')) {
      return [parseDefault(problem.details || problem)];
    }
    if (problem.tag) {
      return parseTaggedProblem(problem, functions);
    }
    let regex = null;
    let matches = null;
    regex = /^(The module name is messed up for )(.+)(\n\n    According to the file's name it should be )(.+)(\n    According to the source code it should be )(.+)(\n\nWhich is it\?)$/;
    matches = problem.match(regex);
    if (matches && matches.length > 7) {
      const filePath = matches[2];
      const expectedModuleName = matches[4];
      const actualModuleName = matches[6];
      return [
        parseDefault(matches[1]),
        parseInfo(filePath),
        parseDefault(matches[3]),
        parseCorrectName(expectedModuleName),
        parseDefault(matches[5]),
        parseIncorrectName(actualModuleName),
        parseDefault(matches[7]),
      ];
    }
    regex = /^(I cannot find module ')(.+)('\.\n\nModule ')(.+)(' is trying to import it\.((?:.|\n)+))/;
    // TODO: Highlight the import statement.
    matches = problem.match(regex);
    if (matches && matches.length > 5) {
      const notFoundModuleName = matches[2];
      const usingModuleName = matches[4];
      return [
        parseDefault(matches[1]),
        parseIncorrectName(notFoundModuleName),
        parseDefault(matches[3]),
        parseInfo(usingModuleName),
        parseDefault(matches[5]),
      ];
    }
    // TODO:
    // I cannot parse the JSON. Maybe a comma is missing? Or there is an extra one?
    // It could also be because of mismatched brackets or quotes.
    //
    // You can also check out the following example to see what it should look like:
    // <https://raw.githubusercontent.com/elm-lang/html/master/elm-package.json>
    return parseDefault(problem);
  },
};

function parseTaggedProblem(problem, functions) {
  let regex = null;
  let matches = null;
  switch (problem.tag) {
    case 'TYPE MISMATCH':
      regex = /^(The type annotation for `)(.+)(` says it always returns:\n\n)((?:.|\n)+)(\n\nBut the returned value \(shown above\) is a:\n\n)((?:.|\n)+)/;
      matches = problem.details.match(regex);
      if (matches && matches.length > 6) {
        const name = matches[2];
        const expectedType = matches[4];
        const hints = matches[6].split('\n\n');
        const actualType = hints.shift();
        return [
          parseDefault(matches[1]),
          parseEmphasis(name),
          parseDefault(matches[3]),
          parseExpectedType(expectedType, actualType),
          parseDefault(matches[5]),
          parseActualType(expectedType, actualType),
          parseHints(hints, functions),
        ];
      }
      regex = /^(The type annotation for `)(.+)(` says it is a:\n\n)((?:.|\n)+)(\n\nBut the definition \(shown above\) is a:\n\n)((?:.|\n)+)/;
      matches = problem.details.match(regex);
      if (matches && matches.length > 6) {
        const name = matches[2];
        const expectedType = matches[4];
        const hints = matches[6].split('\n\n');
        const actualType = hints.shift();
        return [
          parseDefault(matches[1]),
          parseEmphasis(name),
          parseDefault(matches[3]),
          parseExpectedType(expectedType, actualType),
          parseDefault(matches[5]),
          parseActualType(expectedType, actualType),
          parseHints(hints, functions),
        ];
      }
      regex = /^(Function `)(.+)(`\sis\sexpecting\sthe\s)(.+)(\sargument\sto\sbe:\n\n)((?:.|\n)+)(\n\nBut it is:\n\n)((?:.|\n)+)/;
      matches = problem.details.match(regex);
      if (matches && matches.length > 8) {
        const name = matches[2];
        const argOrdinality = matches[4];
        const expectedType = matches[6];
        const hints = matches[8].split('\n\n');
        const actualType = hints.shift();
        return [
          parseDefault(matches[1]),
          parseEmphasis(name),
          parseDefault(matches[3]),
          parseEmphasis(argOrdinality),
          parseDefault(matches[5]),
          parseExpectedType(expectedType, actualType),
          parseDefault(matches[7]),
          parseActualType(expectedType, actualType),
          parseHints(hints, functions),
        ];
      }
      regex = /^(.+)( is expecting the )(left argument)( to be a:\n\n)((?:.|\n)+)(\n\nBut the )(left argument)( is:\n\n)((?:.|\n)+)/;
      matches = problem.details.match(regex);
      if (matches && matches.length > 9) {
        const name = matches[1];
        const expectedType = matches[5];
        const hints = matches[9].split('\n\n');
        const actualType = hints.shift();
        return [
          parseEmphasis(name),
          parseDefault(matches[2]),
          parseEmphasis(matches[3]),
          parseDefault(matches[4]),
          parseExpectedType(expectedType, actualType),
          parseDefault(matches[6]),
          parseEmphasis(matches[7]),
          parseDefault(matches[8]),
          parseActualType(expectedType, actualType),
          parseHints(hints, functions),
        ];
      }
      regex = /^(The `)(then)(` branch has type:\n\n)((?:.|\n)+)(\n\nBut the `)(else)(` branch is:\n\n)((?:.|\n)+)/;
      matches = problem.details.match(regex);
      if (matches && matches.length > 8) {
        const expectedType = matches[4];
        const hints = matches[8].split('\n\n');
        const actualType = hints.shift();
        return [
          parseDefault(matches[1]),
          parseEmphasis(matches[2]),
          parseDefault(matches[3]),
          parseExpectedType(expectedType, actualType),
          parseDefault(matches[5]),
          parseEmphasis(matches[6]),
          parseDefault(matches[7]),
          parseActualType(expectedType, actualType),
          parseHints(hints, functions),
        ];
      }
      regex = /^(The )(.+)( branch has this type:\n\n)((?:.|\n)+)(\n\nBut the )(.+)( is:\n\n)((?:.|\n)+)/;
      matches = problem.details.match(regex);
      if (matches && matches.length > 8) {
        const branch1Ordinality = matches[2];
        const expectedType = matches[4];
        const branch2Ordinality = matches[6];
        const hints = matches[8].split('\n\n');
        const actualType = hints.shift();
        return [
          parseDefault(matches[1]),
          parseEmphasis(branch1Ordinality),
          parseDefault(matches[3]),
          parseExpectedType(expectedType, actualType),
          parseDefault(matches[5]),
          parseEmphasis(branch2Ordinality),
          parseDefault(matches[7]),
          parseActualType(expectedType, actualType),
          parseHints(hints, functions),
        ];
      }
      regex = /^(The pattern matches things of type:\n\n)((?:.|\n)+)(\n\nBut the values it will actually be trying to match are:\n\n)((?:.|\n)+)/;
      matches = problem.details.match(regex);
      if (matches && matches.length > 4) {
        // Note that the actual type comes before the expected type.
        const actualType = matches[2];
        const hints = matches[4].split('\n\n');
        const expectedType = hints.shift();
        return [
          parseDefault(matches[1]),
          parseActualType(expectedType, actualType),
          parseDefault(matches[3]),
          parseExpectedType(expectedType, actualType),
          parseHints(hints, functions),
        ];
      }
      regex = /^(The anonymous function has type:\n\n)((?:.|\n)+)(\n\nBut you are trying to use it as:\n\n)((?:.|\n)+)/;
      matches = problem.details.match(regex);
      if (matches && matches.length > 4) {
        const expectedType = matches[2];
        const hints = matches[4].split('\n\n');
        const actualType = hints.shift();
        return [
          parseDefault(matches[1]),
          parseExpectedType(expectedType, actualType),
          parseDefault(matches[3]),
          parseActualType(expectedType, actualType),
          parseHints(hints, functions),
        ];
      }
      regex = /^(Function `)(.+)(`\sis\sexpecting\sthe\sargument\sto\sbe:\n\n)((?:.|\n)+)(\n\nBut it is:\n\n)((?:.|\n)+)/;
      matches = problem.details.match(regex);
      if (matches && matches.length > 6) {
        const name = matches[2];
        const expectedType = matches[4];
        const hints = matches[6].split('\n\n');
        const actualType = hints.shift();
        return [
          parseDefault(matches[1]),
          parseEmphasis(name),
          parseDefault(matches[3]),
          parseExpectedType(expectedType, actualType),
          parseDefault(matches[5]),
          parseActualType(expectedType, actualType),
          parseHints(hints, functions),
        ];
      }
      regex = /(The number definitely has this type:\n\n)((?:.|\n)+)(\n\nBut it is being used as:\n\n)((?:.|\n)+)/;
      matches = problem.details.match(regex);
      if (matches && matches.length > 4) {
        const expectedType = matches[2];
        const hints = matches[4].split('\n\n');
        const actualType = hints.shift();
        return [
          parseDefault(matches[1]),
          parseExpectedType(expectedType, actualType),
          parseDefault(matches[3]),
          parseActualType(expectedType, actualType),
          parseHints(hints, functions),
        ];
      }
      regex = /(.+)( is expecting the )(right side)( to be a:\n\n)((?:.|\n)+)(\n\nBut the )(right side)( is:\n\n)((?:.|\n)+)/;
      matches = problem.details.match(regex);
      if (matches && matches.length > 9) {
        const name = matches[1];
        const expectedType = matches[5];
        const hints = matches[9].split('\n\n');
        const actualType = hints.shift();
        return [
          parseEmphasis(name),
          parseDefault(matches[2]),
          parseEmphasis(matches[3]),
          parseDefault(matches[4]),
          parseExpectedType(expectedType, actualType),
          parseDefault(matches[6]),
          parseEmphasis(matches[7]),
          parseDefault(matches[8]),
          parseActualType(expectedType, actualType),
          parseHints(hints, functions),
        ];
      }
      regex = /^(The type of `)(.+)(` is:\n\n)((?:.|\n)+)(\n\nWhich does not contain a field named `)(.+)(`\.)((?:.|\n)*)/;
      matches = problem.details.match(regex);
      if (matches && matches.length > 8) {
        const recordName = matches[2];
        const actualType = matches[4];
        const field = matches[6];
        const hints = matches[8].split('\n\n');
        return [
          parseDefault(matches[1]),
          parseEmphasis(recordName, {
            getTokenInfoFunction: () => {
              functions.getTokenInfoFunction(
                problem.file,
                getProblemRange(problem).start,
                recordName
              );
            },
            goToDefinitionFunction: () => {
              functions.goToDefinitionFunction(
                getProblemRange(problem).end,
                recordName
              );
            },
          }),
          parseDefault(matches[3]),
          parseActualType(actualType, actualType),
          parseDefault(matches[5]),
          parseIncorrectName(field),
          parseDefault(matches[7]),
          parseHints(hints, functions),
        ];
      }
      regex = /^(You have given me a condition with this type:\n\n)((?:.|\n)+)(\n\nBut I need it to be:\n\n)((?:.|\n)+)/;
      matches = problem.details.match(regex);
      if (matches && matches.length > 4) {
        // Note that the actual type comes before the expected type.
        const actualType = matches[2];
        const hints = matches[4].split('\n\n');
        const expectedType = hints.shift();
        return [
          parseDefault(matches[1]),
          parseActualType(expectedType, actualType),
          parseDefault(matches[3]),
          parseExpectedType(expectedType, actualType),
          parseHints(hints, functions),
        ];
      }
      regex = /^(Based on its definition, `)(.+)(` has this type:\n\n)((?:.|\n)+)(\n\nBut you are trying to use it as:\n\n)((?:.|\n)+)/;
      matches = problem.details.match(regex);
      if (matches && matches.length > 6) {
        const name = matches[2];
        const expectedType = matches[4];
        const hints = matches[6].split('\n\n');
        const actualType = hints.shift();
        return [
          parseDefault(matches[1]),
          parseEmphasis(name),
          parseDefault(matches[3]),
          parseExpectedType(expectedType, actualType),
          parseDefault(matches[5]),
          parseActualType(expectedType, actualType),
          parseHints(hints, functions),
        ];
      }
      return parseDefault(problem.details);

    case 'NAMING ERROR':
      regex = /^(Maybe you want one of the following\?\n\n)((?:.|\n)+)$/;
      matches = problem.details.match(regex);
      if (matches && matches.length > 2) {
        const suggestions = matches[2];
        return [parseDefault(matches[1]), parseEmphasis(suggestions)];
      }
      regex = /^(No module called `)(.+)`( has been imported\.(?:\s|))$/;
      matches = problem.details.match(regex);
      if (matches && matches.length > 3) {
        const moduleName = matches[2];
        return [
          parseDefault(matches[1]),
          parseEmphasis(moduleName),
          parseDefault(matches[3]),
        ];
      }
      regex = /^(`)(.+)(` does not expose `)(.+)(`\.)(| | Maybe you want one of the following\?\n\n)((?:.|\n)+)$/;
      matches = problem.details.match(regex);
      if (matches && matches.length > 7) {
        const moduleName = matches[2];
        const unexposed = matches[4];
        const suggestions = matches[7];
        return [
          parseDefault(matches[1]),
          parseInfo(moduleName),
          parseDefault(matches[3]),
          parseIncorrectName(unexposed),
          parseDefault(matches[5]),
          parseDefault(matches[6]),
          parseEmphasis(suggestions),
        ];
      }
      return parseDefault(problem.details);

    case 'SYNTAX PROBLEM':
      regex = /^(I am looking for one of the following things:\n\n)((?:.|\n)+)$/;
      matches = problem.details.match(regex);
      if (matches && matches.length > 2) {
        const suggestions = matches[2];
        return [parseDefault(matches[1]), parseEmphasis(suggestions)];
      }
      regex = /^(Maybe )<(.+)>( can help you figure it out\.)$/;
      matches = problem.details.match(regex);
      if (matches && matches.length > 3) {
        const url = matches[2];
        return [
          parseDefault(matches[1]),
          parseUrl(url),
          parseDefault(matches[3]),
        ];
      }
      return parseDefault(problem.details);

    case 'MISSING PATTERNS':
      regex = /^(You need to account for the following values:\n\n)((?:.|\n)+)(\n\n(?:Add a branch to cover this pattern!|Add branches to cover each of these patterns!)\n\nIf you are seeing this error for the first time, check out these hints:\n)<(.+)>(\nThe recommendations about )(wildcard patterns)( and `)(Debug\.crash)(` are important!)$/;
      matches = problem.details.match(regex);
      if (matches && matches.length > 9) {
        const missingPatterns = matches[2];
        const url = matches[4];
        const wildcard = matches[6];
        const debugCrash = matches[8];
        return [
          parseDefault(matches[1]),
          parseIncorrectType(missingPatterns),
          parseDefault(matches[3]),
          parseUrl(url),
          parseDefault(matches[5]),
          parseInfo(wildcard),
          parseDefault(matches[7]),
          parseInfo(debugCrash),
          parseDefault(matches[9]),
        ];
      }
      return parseDefault(problem.details);

    case 'missing type annotation':
      regex = /^(I inferred the type annotation so you can copy it into your code:\n\n)((?:.|\n)+)$/;
      matches = problem.details.match(regex);
      if (matches && matches.length > 2) {
        const inferredType = matches[2];
        return [parseDefault(matches[1]), parseEmphasis(inferredType)];
      }
      return parseDefault(problem.details);

    case 'PORT ERROR':
      regex = /^(You are saying it should be:\n\n)((?:.|\n)+)(\n\nBut you need to use the particular format described here:\n)<(.+)>$/;
      matches = problem.details.match(regex);
      if (matches && matches.length > 3) {
        const actualType = matches[2];
        const url = matches[4];
        return [
          parseDefault(matches[1]),
          parseIncorrectType(actualType),
          parseDefault(matches[3]),
          parseUrl(url),
        ];
      }
      regex = /^(The specific unsupported type is:\n\n)((?:.|\n)+)(\n\nThe types of values that can flow through in and out of Elm include:\n\n((?:.|\n)+))$/;
      matches = problem.details.match(regex);
      if (matches && matches.length > 3) {
        const actualType = matches[2];
        return [
          parseDefault(matches[1]),
          parseIncorrectType(actualType),
          parseDefault(matches[3]),
        ];
      }
      return parseDefault(problem.details);

    case 'BAD RECURSION':
      regex = /^((?:.|\n)+To really learn what is going on and how to fix it, check out:\n)<(.+)>$/;
      matches = problem.details.match(regex);
      if (matches && matches.length > 2) {
        const url = matches[2];
        return [parseDefault(matches[1]), parseUrl(url)];
      }
      return parseDefault(problem.details);

    default:
      return parseDefault(problem.details);
  }
}

function parseEmphasis(text, props) {
  return {
    type: 'emphasis',
    text,
    props,
  };
}

function parseInfo(text) {
  return {
    type: 'info',
    text,
  };
}

function parseExpectedType(expected, actual) {
  return {
    type: 'expectedType',
    expected,
    actual,
  };
}

function parseActualType(expected, actual) {
  return {
    type: 'actualType',
    expected,
    actual,
  };
}

function parseExpectedName(expected, actual) {
  return {
    type: 'expectedName',
    expected,
    actual,
  };
}

function parseActualName(expected, actual) {
  return {
    type: 'actualName',
    expected,
    actual,
  };
}

function parseIncorrectType(type) {
  return {
    type: 'incorrectType',
    text: type,
  };
}

function parseCorrectName(name) {
  return {
    type: 'correctName',
    text: name,
  };
}

function parseIncorrectName(name) {
  return {
    type: 'incorrectName',
    text: name,
  };
}

function parseHint(hint) {
  let hintString;
  let regex;
  let matches;
  regex = /^(The record fields do not match up\. Maybe you made one of these typos\?\n    )((?:.|\n)+)/;
  matches = hint.match(regex);
  if (matches && matches.length > 2) {
    const typos = matches[2];
    const parts = typos
      .split('\n')
      .filter(part => {
        return part.length > 0;
      })
      .map(part => {
        const partMatches = part.match(/^(\s*)(\S+) <-> (\S+)$/);
        if (partMatches && partMatches.length > 3) {
          const leadingSpaces = partMatches[1];
          const expected = partMatches[2];
          const actual = partMatches[3];
          return [
            parseDefault(leadingSpaces),
            parseExpectedName(expected, actual),
            parseDefault(' <> '),
            parseActualName(expected, actual),
          ];
        }
        return parseDefault(part);
      });
    return [parseDefault(matches[1]), parts];
  }
  regex = /^(Problem in the `)(.+)(` field\.((?:.|\n)+))$/;
  matches = hint.match(regex);
  if (matches && matches.length > 3) {
    const name = matches[2];
    return [
      parseDefault(matches[1]),
      parseInfo(name),
      parseDefault(matches[3]),
    ];
  }
  regex = /^(Problem at `)(.+)(`\.((?:.|\n)+))$/;
  matches = hint.match(regex);
  if (matches && matches.length > 3) {
    const name = matches[2];
    return [
      parseDefault(matches[1]),
      parseInfo(name),
      parseDefault(matches[3]),
    ];
  }
  regex = /^(I am seeing issues with the )((?:.|\n)+)((?:\n| )fields\.((?:.|\n)+))$/;
  matches = hint.match(regex);
  if (matches && matches.length > 3) {
    return [
      parseDefault(matches[1]),
      parseFieldsWithIssues(matches[2], parseInfo),
      parseDefault(matches[3]),
    ];
  }
  regex = /^(With operators like )(.+)( I always check the left side first\. If it seems\nfine, I assume it is correct and check the right side\. So the problem may be in\nhow the left and right arguments interact\.)$/;
  matches = hint.match(regex);
  if (matches && matches.length > 3) {
    const name = matches[2];
    return [
      parseDefault(matches[1]),
      parseEmphasis(name),
      parseDefault(matches[3]),
    ];
  }
  regex = /^(Looks like a record is missing the `)(.+)(` field\.)$/;
  matches = hint.match(regex);
  if (matches && matches.length > 3) {
    const name = matches[2];
    return [
      parseDefault(matches[1]),
      parseCorrectName(name),
      parseDefault(matches[3]),
    ];
  }
  regex = /^(Looks like a record is missing these fields: )((?:.|\n)+)$/;
  matches = hint.match(regex);
  if (matches && matches.length > 2) {
    return [
      parseDefault(matches[1]),
      parseFieldsWithIssues(matches[2], parseCorrectName),
    ];
  }
  regex = /^(The\srecord\sfields\sdo\snot\smatch\sup\.\sOne\shas\s)(.+)(\.\sThe\sother\shas\s)(.+)(\.)$/;
  matches = hint.match(regex);
  if (matches && matches.length > 5) {
    return [
      parseDefault(matches[1]),
      parseFieldsWithIssues(matches[2], parseCorrectName),
      parseDefault(matches[3]),
      parseFieldsWithIssues(matches[4], parseIncorrectName),
      parseDefault(matches[5]),
    ];
  }
  regex = /^(I always figure out the type of arguments from left to right\. If an\nargument is acceptable when I check it, I assume it is "correct" in subsequent\nchecks\. So the problem may actually be in how previous arguments interact with\nthe )(.+)(\.)$/;
  matches = hint.match(regex);
  if (matches && matches.length > 3) {
    const argOrdinality = matches[2];
    return [
      parseDefault(matches[1]),
      parseEmphasis(argOrdinality),
      parseDefault(matches[3]),
    ];
  }
  regex = /^(All branches in a `)(case)(` must have the same type\. So no matter which one\nwe take, we always get back the same type of value\.)$/;
  matches = hint.match(regex);
  if (matches && matches.length > 3) {
    return [
      parseDefault(matches[1]),
      parseEmphasis('case'),
      parseDefault(matches[3]),
    ];
  }
  regex = /^(It looks like a function needs )(.+)( more argument(?:s|)\.)$/;
  matches = hint.match(regex);
  if (matches && matches.length > 3) {
    const numArgsNeeded = matches[2];
    return [
      parseDefault(matches[1]),
      parseCorrectName(numArgsNeeded),
      parseDefault(matches[3]),
    ];
  }
  regex = /^(To append strings in Elm, you need to use the )(\(\+\+\))( operator, not )(\(\+\))(\.\n)<(.+)>$/;
  matches = hint.match(regex);
  if (matches && matches.length > 6) {
    const url = matches[6];
    return [
      parseDefault(matches[1]),
      parseInfo('(++)'),
      parseDefault(matches[3]),
      parseInfo('(+)'),
      parseDefault(matches[5]),
      parseUrl(url),
    ];
  }
  regex = /^(The type annotation says there (?:are |is ))(NO|\d+)( argument(?:s|), but there (?:are |is ))(NO|\d+)( argument(?:s|)\nnamed in the definition\. It is best practice for each argument in the type to\ncorrespond to a named argument in the definition, so try that first!)$/;
  matches = hint.match(regex);
  if (matches && matches.length > 5) {
    const numExpectedArgs = matches[2];
    const numActualArgs = matches[4];
    return [
      parseDefault(matches[1]),
      parseExpectedName(numExpectedArgs, numActualArgs),
      parseDefault(matches[3]),
      parseActualName(numExpectedArgs, numActualArgs),
      parseDefault(matches[5]),
    ];
  }
  regex = /((?:.+)More at:\n)<(.+)>$/;
  matches = hint.match(regex);
  if (matches && matches.length > 2) {
    const url = matches[2];
    return [parseDefault(matches[1]), parseUrl(url)];
  }
  return parseDefault(hint);
}

function parseHints(hints) {
  if (hints) {
    return hints
      .filter(hint => {
        return hint.trim().length > 0;
      })
      .map(hint => {
        return {
          type: 'hint',
          parts: _.flatten(parseHint(hint.replace('Hint: ', ''))),
        };
      });
  }
  return [];
}

function parseFieldsWithIssues(fields, parseFunction) {
  const nameParts = fields.split(/,/g);
  if (nameParts.length === 1) {
    const parts = nameParts[0].split(' and ');
    if (parts.length === 1) {
      return parseFunction(parts[0]);
    }
    return [
      parseFunction(parts[0]),
      parseDefault(' and '),
      parseFunction(parts[1]),
    ];
  } else {
    const last = nameParts.pop();
    let [_, lastConj, lastFieldName] = last.match(/(and(?:\n| ))(.+)/);
    return [
      nameParts.map(name => {
        let [_, conj, fieldName] = name.match(/((?:\n|))(.+)/);
        return [
          parseDefault(conj),
          parseFunction(fieldName.trim()),
          parseDefault(', '),
        ];
      }),
      parseDefault(lastConj),
      parseFunction(lastFieldName),
    ];
  }
}

function parseUrl(url) {
  return {
    type: 'url',
    text: url,
  };
}

function parseDefault(text) {
  return {
    type: 'default',
    text,
  };
}

function getProblemRange(problem) {
  return helper.regionToRange(problem.subregion || problem.region);
}