import { testJoin } from './testUtils';

describe('complex queries', () => {

  const execute = testJoin({
    test: `
      type Query { foo: Bar}
      type Bar { bar: Baz, one: String, two: String }
      type Baz { baz(testArg: String): String }
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

  test('cross aliased fields in client query', async () => {
    await execute(`
      {
        foo {
          bar: __typename,
          __typename: bar { baz }
          one: two
          two: one
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

  test('@skip/@include in client query', async () => {
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

  test('variable in client query', async () => {
    await execute({
      query: `query ($testVar: String) {
        foo {
          bar {
            baz(testArg: $testVar)
          }
        }
      }`,
      variableValues: { testVar: 'testValue' }
    });
  });

  test('undefined variable in client query', async () => {
    await execute(`
      query ($testVar: String) {
        foo {
          bar {
            baz(testArg: $testVar)
          }
        }
      }
    `);
  });

  test('default variable value in client query', async () => {
    await execute(`
      query ($testVar: String = "defaultValue") {
        foo {
          bar {
            baz(testArg: $testVar)
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
