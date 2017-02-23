'use babel';

// TODO: Add anchor tags to links.

import _ from 'underscore';
const jsdiff = require('diff');
import helper from './helper';

export default {
  formatProblemDetails(problem) {
    if (!atom.config.get('linter-elm-make.applyStylingToMessages')) {
      return formatDefault(problem.details || problem);
    }
    if (problem.tag) {
      return formatTaggedProblem(problem);
    }
    let regex = null;
    let matches = null;
    regex = /^(The module name is messed up for )(.+)(\n\n    According to the file's name it should be )(.+)(\n    According to the source code it should be )(.+)(\n\nWhich is it\?)$/;
    matches = problem.match(regex);
    if (matches && matches.length > 7) {
      const filePath = matches[2];
      const expectedModuleName = matches[4];
      const actualModuleName = matches[6];
      return problem.replace(regex,
        '$1' + formatInfo(filePath) +
        '$3' + formatCorrectName(expectedModuleName) +
        '$5' + formatIncorrectName(actualModuleName) +
        '$7');
    }
    regex = /^(I cannot find module ')(.+)('\.\n\nModule ')(.+)(' is trying to import it\.((?:.|\n)+))/;
    // TODO: Highlight the import statement.
    matches = problem.match(regex);
    if (matches && matches.length > 5) {
      const notFoundModuleName = matches[2];
      const usingModuleName = matches[4];
      return problem.replace(regex, '$1' + formatIncorrectName(notFoundModuleName) + '$3' + formatInfo(usingModuleName) +'$5');
    }
    return formatDefault(problem);
  }
};

function formatTaggedProblem(problem) {
  let regex = null;
  let matches = null;
  switch (problem.tag) {
    case 'TYPE MISMATCH':
      regex = /^The type annotation for `(.+)` says it always returns:\n\n((?:.|\n)+)\n\nBut the returned value \(shown above\) is a:\n\n((?:.|\n)+)/;
      matches = problem.details.match(regex);
      if (matches && matches.length > 3) {
        const name = matches[1];
        const expectedType = matches[2];
        const hints = matches[3].split('\n\n');
        const actualType = hints.shift();
        return problem.details.replace(regex,
          'The type annotation for `' + emphasize(name) + '` says it always returns:\n\n' +
          formatExpectedType(expectedType, actualType) + '\n\n' +
          'But the returned value (shown above) is a:\n\n' +
          formatActualType(expectedType, actualType) +
          formatHints(hints));
      }
      regex = /^The type annotation for `(.+)` says it is a:\n\n((?:.|\n)+)\n\nBut the definition \(shown above\) is a:\n\n((?:.|\n)+)/;
      matches = problem.details.match(regex);
      if (matches && matches.length > 3) {
        const name = matches[1];
        const expectedType = matches[2];
        const hints = matches[3].split('\n\n');
        const actualType = hints.shift();
        return problem.details.replace(regex,
          'The type annotation for `' + emphasize(name) + '` says it is a:\n\n' +
          formatExpectedType(expectedType, actualType) + '\n\n' +
          'But the definition (shown above) is a:\n\n' +
          formatActualType(expectedType, actualType) +
          formatHints(hints));
      }
      regex = /^(Function `)(.+)(`\sis\sexpecting\sthe\s)(.+)(\sargument\sto\sbe:\n\n)((?:.|\n)+)(\n\nBut it is:\n\n)((?:.|\n)+)/;
      matches = problem.details.match(regex);
      if (matches && matches.length > 8) {
        const name = matches[2];
        const argOrdinality = matches[4];
        const expectedType = matches[6];
        const hints = matches[8].split('\n\n');
        const actualType = hints.shift();
        return problem.details.replace(regex,
          '$1' + emphasize(name) + '$3' + emphasize(argOrdinality) + '$5' +
          formatExpectedType(expectedType, actualType) + '$7' +
          formatActualType(expectedType, actualType) +
          formatHints(hints));
      }
      regex = /^(.+) is expecting the left argument to be a:\n\n((?:.|\n)+)\n\nBut the left argument is:\n\n((?:.|\n)+)/;
      matches = problem.details.match(regex);
      if (matches && matches.length > 3) {
        const name = matches[1];
        const expectedType = matches[2];
        const hints = matches[3].split('\n\n');
        const actualType = hints.shift();
        return problem.details.replace(regex,
          emphasize(name) + ' is expecting the ' + emphasize('left argument') + ' to be a:\n\n' +
          formatExpectedType(expectedType, actualType) + '\n\n' +
          'But the ' + emphasize('left argument') + ' is:\n\n' +
          formatActualType(expectedType, actualType) +
          formatHints(hints));
      }
      regex = /^The `then` branch has type:\n\n((?:.|\n)+)\n\nBut the `else` branch is:\n\n((?:.|\n)+)/;
      matches = problem.details.match(regex);
      if (matches && matches.length > 2) {
        const expectedType = matches[1];
        const hints = matches[2].split('\n\n');
        const actualType = hints.shift();
        return problem.details.replace(regex,
          'The `' + emphasize('then') + '` branch has type:\n\n' +
          formatExpectedType(expectedType, actualType) + '\n\n' +
          'But the `' + emphasize('else') + '` branch is:\n\n' +
          formatActualType(expectedType, actualType) +
          formatHints(hints));
      }
      regex = /^The (.+) branch has this type:\n\n((?:.|\n)+)\n\nBut the (.+) is:\n\n((?:.|\n)+)/;
      matches = problem.details.match(regex);
      if (matches && matches.length > 4) {
        const branch1Ordinality = matches[1];
        const expectedType = matches[2];
        const branch2Ordinality = matches[3];
        const hints = matches[4].split('\n\n');
        const actualType = hints.shift();
        return problem.details.replace(regex,
          'The ' + emphasize(branch1Ordinality) +  ' branch has this type:\n\n' +
          formatExpectedType(expectedType, actualType) + '\n\n' +
          'But the ' + emphasize(branch2Ordinality) + ' is:\n\n' +
          formatActualType(expectedType, actualType) +
          formatHints(hints));
      }
      regex = /^The pattern matches things of type:\n\n((?:.|\n)+)\n\nBut the values it will actually be trying to match are:\n\n((?:.|\n)+)/;
      matches = problem.details.match(regex);
      if (matches && matches.length > 2) {
        // Note that the actual type comes before the expected type.
        const actualType = matches[1];
        const hints = matches[2].split('\n\n');
        const expectedType = hints.shift();
        return problem.details.replace(regex,
          'The pattern matches things of type:\n\n' +
          formatActualType(expectedType, actualType) + '\n\n' +
          'But the values it will actually be trying to match are:\n\n' +
          formatExpectedType(expectedType, actualType) +
          formatHints(hints));
      }
      regex = /^(Function `)(.+)(`\sis\sexpecting\sthe\sargument\sto\sbe:\n\n)((?:.|\n)+)(\n\nBut it is:\n\n)((?:.|\n)+)/;
      matches = problem.details.match(regex);
      if (matches && matches.length > 6) {
        const name = matches[2];
        const expectedType = matches[4];
        const hints = matches[6].split('\n\n');
        const actualType = hints.shift();
        return problem.details.replace(regex,
          '$1' + emphasize(name) + '$3' +
          formatExpectedType(expectedType, actualType) + '$5' +
          formatActualType(expectedType, actualType) +
          formatHints(hints));
      }
      regex = /The number definitely has this type:\n\n((?:.|\n)+)\n\nBut it is being used as:\n\n((?:.|\n)+)/;
      matches = problem.details.match(regex);
      if (matches && matches.length > 2) {
        const expectedType = matches[1];
        const hints = matches[2].split('\n\n');
        const actualType = hints.shift();
        return problem.details.replace(regex,
          'The number definitely has this type:\n\n' +
          formatExpectedType(expectedType, actualType) + '\n\n' +
          'But it is being used as:\n\n' +
          formatActualType(expectedType, actualType) +
          formatHints(hints));
      }
      regex = /(.+) is expecting the right side to be a:\n\n((?:.|\n)+)\n\nBut the right side is:\n\n((?:.|\n)+)/;
      matches = problem.details.match(regex);
      if (matches && matches.length > 2) {
        const name = matches[1];
        const expectedType = matches[2];
        const hints = matches[3].split('\n\n');
        const actualType = hints.shift();
        return problem.details.replace(regex,
          emphasize(name) + ' is expecting the ' + emphasize('right side') + ' to be a:\n\n' +
          formatExpectedType(expectedType, actualType) + '\n\n' +
          'But the ' + emphasize('right side') + ' is:\n\n' +
          formatActualType(expectedType, actualType) +
          formatHints(hints));
      }
      regex = /^The type of `(.+)` is:\n\n((?:.|\n)+)\n\nWhich does not contain a field named `(.+)`\.((?:.|\n)*)/;
      matches = problem.details.match(regex);
      if (matches && matches.length > 3) {
        const record = matches[1];
        const actualType = matches[2];
        const field = matches[3];
        const hints = matches[4].split('\n\n');
        return problem.details.replace(regex,
          'The type of `' + emphasize(record) + '` is:\n\n' +
          formatActualType(actualType, actualType) + '\n\n' +
          'Which does not contain a field named `' + formatIncorrectName(field) + '`.' +
          formatHints(hints));
      }
      regex = /^You have given me a condition with this type:\n\n((?:.|\n)+)\n\nBut I need it to be:\n\n((?:.|\n)+)/;
      matches = problem.details.match(regex);
      if (matches && matches.length > 2) {
        // Note that the actual type comes before the expected type.
        const actualType = matches[1];
        const hints = matches[2].split('\n\n');
        const expectedType = hints.shift();
        return problem.details.replace(regex,
          'You have given me a condition with this type:\n\n' +
          formatActualType(expectedType, actualType) + '\n\n' +
          'But I need it to be:\n\n' +
          formatExpectedType(expectedType, actualType) +
          formatHints(hints));
      }
      return formatDefault(problem.details);

    case 'NAMING ERROR':
      regex = /^(Maybe you want one of the following\?\n\n)((?:.|\n)+)$/;
      matches = problem.details.match(regex);
      if (matches && matches.length > 2) {
        const suggestions = matches[2];
        return problem.details.replace(regex, '$1' + emphasize(suggestions));
      }
      regex = /^(No module called `)(.+)`( has been imported\.(?:\s|))$/;
      matches = problem.details.match(regex);
      if (matches && matches.length > 3) {
        const moduleName = matches[2];
        return problem.details.replace(regex, '$1' + emphasize(moduleName) + '$3');
      }
      regex = /^(`)(.+)(` does not expose `)(.+)(`\.)(| | Maybe you want one of the following\?\n\n)((?:.|\n)+)$/;
      matches = problem.details.match(regex);
      if (matches && matches.length > 7) {
        const moduleName = matches[2];
        const unexposed = matches[4];
        const suggestions = matches[7];
        return problem.details.replace(regex, '$1' + formatInfo(moduleName) + '$3' + formatIncorrectName(unexposed) + '$5$6' + emphasize(suggestions));
      }
      return formatDefault(problem.details);

    case 'SYNTAX PROBLEM':
      regex = /^(I am looking for one of the following things:\n\n)((?:.|\n)+)$/;
      matches = problem.details.match(regex);
      if (matches && matches.length > 2) {
        const suggestions = matches[2];
        return problem.details.replace(regex, '$1' + emphasize(suggestions));
      }
      regex = /^(Maybe )<(.+)>( can help you figure it out\.)$/;
      matches = problem.details.match(regex);
      if (matches && matches.length > 3) {
        const url = matches[2];
        return problem.details.replace(regex, '$1' + formatUrl(url) + '$3');
      }
      return formatDefault(problem.details);

    case 'MISSING PATTERNS':
      regex = /^(You need to account for the following values:\n\n)((?:.|\n)+)(\n\n(?:Add a branch to cover this pattern!|Add branches to cover each of these patterns!)\n\nIf you are seeing this error for the first time, check out these hints:\n)<(.+)>(\nThe recommendations about )(wildcard patterns)( and `)(Debug\.crash)(` are important!)$/;
      matches = problem.details.match(regex);
      if (matches && matches.length > 9) {
        const missingPatterns = matches[2];
        const url = _.escape(matches[4]);
        const wildcard = matches[6];
        const debugCrash = matches[8];
        return problem.details.replace(regex, '$1' + formatIncorrectType(missingPatterns) + '$3' + formatUrl(url) + '$5' + formatInfo(wildcard) + '$7' + formatInfo(debugCrash) + '$9');
      }
      return formatDefault(problem.details);

    case 'missing type annotation':
      regex = /^(I inferred the type annotation so you can copy it into your code:\n\n)((?:.|\n)+)$/;
      matches = problem.details.match(regex);
      if (matches && matches.length > 2) {
        const inferredType = matches[2];
        return problem.details.replace(regex, '$1' + emphasize(inferredType));
      }
      return formatDefault(problem.details);

    case 'PORT ERROR':
      regex = /^(You are saying it should be:\n\n)((?:.|\n)+)(\n\nBut you need to use the particular format described here:\n)<(.+)>$/;
      matches = problem.details.match(regex);
      if (matches && matches.length > 3) {
        const actualType = matches[2];
        const url = _.escape(matches[4]);
        return problem.details.replace(regex, '$1' + formatIncorrectType(actualType) + '$3' + formatUrl(url));
      }
      regex = /^(The specific unsupported type is:\n\n)((?:.|\n)+)(\n\nThe types of values that can flow through in and out of Elm include:\n\n((?:.|\n)+))$/;
      matches = problem.details.match(regex);
      if (matches && matches.length > 3) {
        const actualType = matches[2];
        return problem.details.replace(regex, '$1' + formatIncorrectType(actualType) + '$3');
      }
      return formatDefault(problem.details);

    case 'BAD RECURSION':
      regex = /^((?:.|\n)+To really learn what is going on and how to fix it, check out:\n)<(.+)>$/;
      matches = problem.details.match(regex);
      if (matches && matches.length > 2) {
        const url = _.escape(matches[2]);
        return problem.details.replace(regex, '$1' + formatUrl(url));
      }
      return formatDefault(problem.details);

    default:
      return formatDefault(problem.details);
  }
}

function emphasize(info) {
  return '<span class="linter-elm-make-details-emphasized">' + _.escape(info) + '</span>';
}

function formatInfo(info) {
  return '<span class="linter-elm-make-details-info">' + _.escape(info) + '</span>';
}

function formatType(type) {
  return type.split('\n').map((line) => {
    return line.replace(helper.tabSpaces(), '');
  }).join('\n');
}

function formatExpectedType(expected, actual) {
  const diff = jsdiff.diffWords(formatType(actual), formatType(expected));
  return '<div class="linter-elm-make-details-expected-type">' +
    diff.map((part) => {
      if (part.added) {
        return '<span class="linter-elm-make-expected-type-diff-changed">' + _.escape(part.value) + '</span>';
      } else if (!part.removed) {
        return '<span>' + _.escape(part.value) + '</span>';
      }
      return '';
    }).join('') +
    '</div>';
}

function formatActualType(expected, actual) {
  const diff = jsdiff.diffWords(formatType(expected), formatType(actual));
  return '<div class="linter-elm-make-details-actual-type">' +
    diff.map((part) => {
      if (part.added) {
        return '<span class="linter-elm-make-actual-type-diff-changed">' + _.escape(part.value) + '</span>';
      } else if (!part.removed) {
        return '<span>' + _.escape(part.value) + '</span>';
      }
      return '';
    }).join('') +
    '</div>';
}

function formatExpectedName(expected, actual) {
  const diff = jsdiff.diffChars(actual, expected);
  return '<span class="linter-elm-make-details-expected-name">' +
    diff.map((part) => {
      if (part.added) {
        return '<span class="linter-elm-make-expected-name-diff-changed">' + _.escape(part.value) + '</span>';
      } else if (!part.removed) {
        return '<span>' + _.escape(part.value) + '</span>';
      }
      return '';
    }).join('') +
    '</span>';
}

function formatActualName(expected, actual) {
  const diff = jsdiff.diffChars(expected, actual);
  return '<span class="linter-elm-make-details-actual-name">' +
    diff.map((part) => {
      if (part.added) {
        return '<span class="linter-elm-make-actual-name-diff-changed">' + _.escape(part.value) + '</span>';
      } else if (!part.removed) {
        return '<span>' + _.escape(part.value) + '</span>';
      }
      return '';
    }).join('') +
    '</span>';
}

function formatIncorrectType(type) {
  return '<div class="linter-elm-make-details-actual-type"><span class="linter-elm-make-actual-type-diff-changed">' + _.escape(formatType(type)) + '</span></span></div>';
}

function formatCorrectName(name) {
  return '<span class="linter-elm-make-details-expected-name"><span class="linter-elm-make-expected-name-diff-changed">' + _.escape(name) + '</span></span></div>';
}

function formatIncorrectName(name) {
  return '<span class="linter-elm-make-details-actual-name"><span class="linter-elm-make-actual-name-diff-changed">' + _.escape(name) + '</span></span></div>';
}

function formatHint(hint) {
  let hintString;
  let regex;
  let matches;
  regex = /^The record fields do not match up\. Maybe you made one of these typos\?\n    ((?:.|\n)+)/;
  matches = hint.match(regex);
  if (matches && matches.length > 1) {
    const typos = matches[1];
    const parts = typos.split('\n')
      .filter((part) => {
        return part.length > 0;
      })
      .map((part) => {
        const partMatches = part.match(/^(\s*)(\S+) <-> (\S+)$/);
        if (partMatches && partMatches.length > 3) {
          const leadingSpaces = partMatches[1];
          const expected = partMatches[2];
          const actual = partMatches[3];
          return leadingSpaces.replace(' ', '&nbsp;') + formatExpectedName(expected, actual) + ' &lt;-&gt; ' + formatActualName(expected, actual);
        }
        return part;
      });
    return hint.replace(regex,
      'The record fields do not match up. Maybe you made one of these typos?\n\n' +
      parts.join('\n'));
  }
  regex = /^(Problem in the `)(.+)(` field\.((?:.|\n)+))$/;
  matches = hint.match(regex);
  if (matches && matches.length > 3) {
    const name = matches[2];
    return hint.replace(regex, '$1' + formatInfo(name) + '$3');
  }
  regex = /^(Problem at `)(.+)(`\.((?:.|\n)+))$/;
  matches = hint.match(regex);
  if (matches && matches.length > 3) {
    const name = matches[2];
    return hint.replace(regex, '$1' + formatInfo(name) + '$3');
  }
  regex = /^(I am seeing issues with the )((?:.|\n)+)((?:\n| )fields\.((?:.|\n)+))$/;
  matches = hint.match(regex);
  if (matches && matches.length > 3) {
    return hint.replace(regex, '$1' + formatFieldsWithIssues(matches[2], formatInfo) + '$3');
  }
  regex = /^(With operators like )(.+)( I always check the left side first\. If it seems\nfine, I assume it is correct and check the right side\. So the problem may be in\nhow the left and right arguments interact\.)$/;
  matches = hint.match(regex);
  if (matches && matches.length > 3) {
    const name = matches[2];
    return hint.replace(regex, '$1' + emphasize(name) + '$3');
  }
  regex = /^(Looks like a record is missing the `)(.+)(` field\.)$/;
  matches = hint.match(regex);
  if (matches && matches.length > 3) {
    const name = matches[2];
    return hint.replace(regex, '$1' + formatCorrectName(name) + '$3');
  }
  regex = /^(Looks like a record is missing these fields: )((?:.|\n)+)$/;
  matches = hint.match(regex);
  if (matches && matches.length > 2) {
    const formatFunction = (field) => {
      return formatCorrectName(field);
    };
    return hint.replace(regex, '$1' + formatFieldsWithIssues(matches[2], formatFunction));
  }
  regex = /^(The record fields do not match up\. One has )(.+)(\.\nThe other has )(.+)(\.)$/;
  matches = hint.match(regex);
  if (matches && matches.length > 5) {
    const formatFunction1 = (field) => {
      return formatCorrectName(field);
    };
    const formatFunction2 = (field) => {
      return formatIncorrectName(field);
    };
    return hint.replace(regex, '$1' + formatFieldsWithIssues(matches[2], formatFunction1) + '$3' + formatFieldsWithIssues(matches[4], formatFunction2) + '$5');
  }
  regex = /^(I always figure out the type of arguments from left to right\. If an\nargument is acceptable when I check it, I assume it is "correct" in subsequent\nchecks\. So the problem may actually be in how previous arguments interact with\nthe )(.+)(\.)$/;
  matches = hint.match(regex);
  if (matches && matches.length > 3) {
    const argOrdinality = matches[2];
    return hint.replace(regex, '$1' + emphasize(argOrdinality) + '$3');
  }
  regex = /^(All branches in a `)(case)(` must have the same type\. So no matter which one\nwe take, we always get back the same type of value\.)$/;
  matches = hint.match(regex);
  if (matches && matches.length > 3) {
    return hint.replace(regex, '$1' + emphasize('case') + '$3');
  }
  regex = /^(It looks like a function needs )(.+)( more argument(?:s|)\.)$/;
  matches = hint.match(regex);
  if (matches && matches.length > 3) {
    const numArgsNeeded = matches[2];
    return hint.replace(regex, '$1' + formatCorrectName(numArgsNeeded) + '$3');
  }
  regex = /^(To append strings in Elm, you need to use the )(\(\+\+\))( operator, not )(\(\+\))(\.\n)<(.+)>$/;
  matches = hint.match(regex);
  if (matches && matches.length > 6) {
    const url = _.escape(matches[6]);
    return hint.replace(regex, '$1' + formatInfo('(++)') + '$3' + formatInfo('(+)') + '$5' + formatUrl(url));
  }
  regex = /^(The type annotation says there (?:are |is ))(NO|\d+)( argument(?:s|), but there (?:are |is ))(NO|\d+)( argument(?:s|)\nnamed in the definition\. It is best practice for each argument in the type to\ncorrespond to a named argument in the definition, so try that first!)$/;
  matches = hint.match(regex);
  if (matches && matches.length > 5) {
    const numExpectedArgs = _.escape(matches[2]);
    const numActualArgs = _.escape(matches[4]);
    return hint.replace(regex, '$1' + formatExpectedName(numExpectedArgs, numActualArgs) + '$3' + formatActualName(numExpectedArgs, numActualArgs) + '$5');
  }
  regex = /((?:.+)More at:\n)<(.+)>$/;
  matches = hint.match(regex);
  if (matches && matches.length > 2) {
    const url = _.escape(matches[2]);
    return hint.replace(regex, '$1' + formatUrl(url));
  }
  return _.escape(hint);
}

function formatHints(hints) {
  if (hints && hints.length > 0) {
    const nonEmptyHints = hints.filter((hint) => {
      return hint.trim().length > 0;
    });
    if (nonEmptyHints.length > 0) {
      return '\n\n' + nonEmptyHints
        .map((hint) => {
          return '<span class="linter-elm-make-details-hint-label"></span> ' +
            '<span class="linter-elm-make-details-hint">' + formatHint(hint.replace('Hint: ', '')) + '</span>';
        }).join('\n\n');
    }
  }
  return '';
}

function formatFieldsWithIssues(fields, formatFunction) {
  const nameParts = fields.split(/,/g);
  if (nameParts.length === 1) {
    const parts = nameParts[0].split(' and ');
    if (parts.length === 1) {
      return formatFunction(parts[0]);
    }
    return formatFunction(parts[0]) + ' and ' + formatFunction(parts[1]);
  } else {
    const last = nameParts.pop();
    let [_, lastConj, lastFieldName] = last.match(/(and(?:\n| ))(.+)/);
    return nameParts.map((name) => {
      let [_, conj, fieldName] = name.match(/((?:\n|))(.+)/);
      return conj + formatFunction(fieldName.trim());
    }).join(', ') + ', ' + lastConj + formatFunction(lastFieldName);
  }
}

function formatUrl(url) {
  return '<a href="' + url + '">' + url + '</a>';
}

function formatDefault(details) {
  return _.escape(details);
}
