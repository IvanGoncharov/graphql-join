declare var describe, test;

import { testJoin } from './testUtils';

describe('type system', () => {

  const execute = testJoin({
    test: `
      type Query { foo: Bar }
      type Bar { bar: Baz }
      type Baz { baz: String }
    `,
  }, 'schema { query: Query }');

  test('field alias in client query', async () => {
    await execute(`
      {
        fooAlias: foo {
          barAlias: bar {
            bazAlias: baz
          }
        }
      }
    `);
  });

});
