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

  test('variables in client query', async () => {
    await execute(`
      query ($true: Boolean = true, $false: Boolean = false) {
        foo @include(if: $true) {
          bar @skip(if: $false) {
            baz @include(if: $true)
          }
        }
      }
    `);
  });

  test('duplicate fields in client query', async () => {
    await execute(`
      {
        foo {
          __typename
        }
        foo {
          bar {
            baz
          }
        }
      }
    `);
  });

});
