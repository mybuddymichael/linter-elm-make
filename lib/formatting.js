'use babel';

// TODO: Add anchor tags to links.

import _ from 'underscore';
const jsdiff = require('diff');

export default {
  formatProblemDetails(problem) {
    if (!atom.config.get('linter-elm-make.applyStylingToMessages')) {
      return _.escape(problem.details);
    }
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
            'The type annotation for `' + formatInfo(name) + '` says it always returns:\n\n' +
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
            'The type annotation for `' + formatInfo(name) + '` says it is a:\n\n' +
            formatExpectedType(expectedType, actualType) + '\n\n' +
            'But the definition (shown above) is a:\n\n' +
            formatActualType(expectedType, actualType) +
            formatHints(hints));
        }
        regex = /^Function `(.+)` is expecting the (.+) argument to be:\n\n((?:.|\n)+)\n\nBut it is:\n\n((?:.|\n)+)/;
        matches = problem.details.match(regex);
        if (matches && matches.length > 4) {
          const name = matches[1];
          const argOrdinality = matches[2];
          const expectedType = matches[3];
          const hints = matches[4].split('\n\n');
          const actualType = hints.shift();
          return problem.details.replace(regex,
            'Function `' + formatInfo(name) + '` is expecting the ' + formatInfo(argOrdinality) + ' argument to be:\n\n' +
            formatExpectedType(expectedType, actualType) + '\n\n' +
            'But it is:\n\n' +
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
            formatInfo(name) + ' is expecting the ' + formatInfo('left argument') + ' to be a:\n\n' +
            formatExpectedType(expectedType, actualType) + '\n\n' +
            'But the ' + formatInfo('left argument') + ' is:\n\n' +
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
            'The `' + formatInfo('then') + '` branch has type:\n\n' +
            formatExpectedType(expectedType, actualType) + '\n\n' +
            'But the `' + formatInfo('else') + '` branch is:\n\n' +
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
            'The ' + formatInfo(branch1Ordinality) +  ' branch has this type:\n\n' +
            formatExpectedType(expectedType, actualType) + '\n\n' +
            'But the ' + formatInfo(branch2Ordinality) + ' is:\n\n' +
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
        regex = /^Function `(.+)` is expecting the argument to be:\n\n((?:.|\n)+)\n\nBut it is:\n\n((?:.|\n)+)/;
        matches = problem.details.match(regex);
        if (matches && matches.length > 3) {
          const name = matches[1];
          const expectedType = matches[2];
          const hints = matches[3].split('\n\n');
          const actualType = hints.shift();
          return problem.details.replace(regex,
            'Function `' + formatInfo(name) + '` is expecting the argument to be:\n\n' +
            formatExpectedType(expectedType, actualType) + '\n\n' +
            'But it is:\n\n' +
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
            formatInfo(name) + ' is expecting the ' + formatInfo('right side') + ' to be a:\n\n' +
            formatExpectedType(expectedType, actualType) + '\n\n' +
            'But the ' + formatInfo('right side') + ' is:\n\n' +
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
            'The type of `' + formatInfo(record) + '` is:\n\n' +
            formatActualType(actualType, actualType) + '\n\n' +
            'Which does not contain a field named `' + formatInfo(field) + '`.' +
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
        return problem.details;
      case 'NAMING ERROR':
        regex = /^(Maybe you want one of the following\?\n\n)((?:.|\n)+)$/;
        matches = problem.details.match(regex);
        if (matches && matches.length > 2) {
          const suggestions = matches[2];
          return problem.details.replace(regex, '$1' + formatInfo(suggestions));
        }
        return problem.details;
      case 'SYNTAX PROBLEM':
        regex = /^(I am looking for one of the following things:\n\n)((?:.|\n)+)$/;
        matches = problem.details.match(regex);
        if (matches && matches.length > 2) {
          const suggestions = matches[2];
          return problem.details.replace(regex, '$1' + formatInfo(suggestions));
        }
        return problem.details;
      case 'missing type annotation':
        regex = /^(I inferred the type annotation so you can copy it into your code:\n\n)((?:.|\n)+)$/;
        matches = problem.details.match(regex);
        if (matches && matches.length > 2) {
          const inferredType = matches[2];
          return problem.details.replace(regex, '$1' + formatInfo(inferredType) + '');
        }
        return problem.details;
      case 'PORT ERROR':
        regex = /^You are saying it should be:\n\n((?:.|\n)+)\n\nBut you need to use the particular format described here:\n<(.+)>$/;
        matches = problem.details.match(regex);
        if (matches && matches.length > 2) {
          const actualType = matches[1];
          const url = _.escape(matches[2]);
          return problem.details.replace(regex,
            'You are saying it should be:\n\n' +
            formatActualType(actualType, actualType) + '\n\n' +
            'But you need to use the particular format described here:\n<a href="' + url + '">' + url + '</a>');
        }
        return problem.details;
      default:
        return problem.details;
    }
  }
};

function formatInfo(info) {
  return '<span class="linter-elm-make-details-info">' + _.escape(info) + '</span>';
}

function formatType(type) {
  const tabSpaces = '    ';
  return type.split('\n').map((line) => {
    return line.replace(tabSpaces, '');
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
  regex = /^(I am seeing issues with the )((?:.|\n)+)((?:\n| )fields\.((?:.|\n)+))$/;
  matches = hint.match(regex);
  if (matches && matches.length > 3) {
    const nameParts = matches[2].split(/, /g);
    let formattedNames;
    if (nameParts.length === 1) {
      const parts = nameParts[0].split(' and ');
      formattedNames = formatInfo(parts[0]) + ' and ' + formatInfo(parts[1]);
    } else {
      const last = nameParts.pop();
      const lastMatches = last.match(/(and(?:\n| ))(.+)/);
      const conj = lastMatches[1];
      const name = lastMatches[2];
      formattedNames = nameParts.map((name) => { return formatInfo(name); }).join(', ') + ', ' + conj + formatInfo(name);
    }
    return hint.replace(regex, '$1' + formattedNames + '$3');
  }
  regex = /^(With operators like )(.+)( I always check the left side first\. If it seems\nfine, I assume it is correct and check the right side\. So the problem may be in\nhow the left and right arguments interact\.)$/;
  matches = hint.match(regex);
  if (matches && matches.length > 3) {
    const name = matches[2];
    return hint.replace(regex, '$1' + formatInfo(name) + '$3');
  }
  regex = /^(Looks like a record is missing the `)(.+)(` field\.)$/;
  matches = hint.match(regex);
  if (matches && matches.length > 3) {
    const name = matches[2];
    return hint.replace(regex, '$1' + formatInfo(name) + '$3');
  }
  regex = /^(I always figure out the type of arguments from left to right\. If an\nargument is acceptable when I check it, I assume it is "correct" in subsequent\nchecks\. So the problem may actually be in how previous arguments interact with\nthe )(.+)(\.)$/;
  matches = hint.match(regex);
  if (matches && matches.length > 3) {
    const argOrdinality = matches[2];
    return hint.replace(regex, '$1' + formatInfo(argOrdinality) + '$3');
  }
  regex = /^(All branches in a `)(case)(` must have the same type\. So no matter which one\nwe take, we always get back the same type of value\.)$/;
  matches = hint.match(regex);
  if (matches && matches.length > 3) {
    return hint.replace(regex, '$1' + formatInfo('case') + '$3');
  }
  regex = /^(It looks like a function needs )(.+)( more argument\.)$/;
  matches = hint.match(regex);
  if (matches && matches.length > 3) {
    const numArgsNeeded = matches[2];
    return hint.replace(regex, '$1' + formatInfo(numArgsNeeded) + '$3');
  }
  regex = /^(To append strings in Elm, you need to use the )(\(\+\+\))( operator, not )(\(\+\))(\.\n)<(.+)>$/;
  matches = hint.match(regex);
  if (matches && matches.length > 6) {
    const url = _.escape(matches[6]);
    return hint.replace(regex, '$1' + formatInfo('(++)') + '$3' + formatInfo('(+)') + '$5<a href="' + url + '">' + url + '</a>');
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
