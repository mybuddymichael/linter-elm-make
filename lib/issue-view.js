'use babel';
import path from 'path';
import * as React from 'react';

export default {
  create() {
    class IssueView extends React.PureComponent {
      render(problems) {
        const elements = problems.map(({html}, i) => {
          return (
            <div className="datatip-marked-container">
              <div
                dangerouslySetInnerHTML={{
                  __html: html,
                }}
                key={i}
              />
            </div>
          );
        });
        return (
          <div className="datatip-marked">
            {elements}
          </div>
        );
      }
    }
    return IssueView;
  }
}
