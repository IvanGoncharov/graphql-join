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

  test('fragments in client query', async () => {
    await execute(`
      {
        ... FooFrag
      }
      fragment FooFrag on Query {
        foo {
          ... BarFrag
        }
      }
      fragment BarFrag on Bar {
        bar {
          ... BazFrag
        }
      }
      fragment BazFrag on Baz {
        baz
      }
    `);
  });

});
