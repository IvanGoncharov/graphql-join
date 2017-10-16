import { testJoin } from './testUtils';

describe('arguments fragment tests', () => {
  test('get argument from fragment', async () => {
    const execute = testJoin(
      {
        test1: `
          type TestType {
            foo: String
          }
          type Query1 {
            testObj: TestType
          }
          schema { query: Query1 }
        `,
        test2: `
          type Query {
            bar(fooArg: String): String
          }
        `,
      }, `
       schema { query: Query1 }
       extend type TestType {
         bar: String @resolveWith(query: "bar", extraArgs: { fromFragment: "FooArg" })
       }
       query bar($foo: String) @send(to: "test2") {
         bar(fooArg:$foo)
       }
       fragment FooArg on TestType {
         foo @export(as: "foo")
       }
      `
    );
    await execute('{ testObj { bar } }');
  });

  test('conflicting fields in fromFragment and client selection', async () => {
    const execute = testJoin({
      test1: `
        type Foo {
          bar(barArg: String): String
        }
        type Query { foo: Foo }
      `,
      test2: `
        type Query { baz(barValue: String): String }
      `,
    }, `
      type Query {
        foo: Foo @resolveWith(query: "foo")
      }
      query foo @send(to: "test1") {
        foo { ...CLIENT_SELECTION }
      }

      extend type Foo {
        baz: String @resolveWith(query: "baz", extraArgs: { fromFragment: "BazArgs" })
      }
      fragment BazArgs on Foo {
        bar(barArg: "FragmentValue") @export(as: "barValue")
      }
      query baz($barValue: String) @send(to: "test2") {
        baz(barValue: $barValue)
      }
    `);
    await execute(`
      {
        foo {
          bar(barArg: "ClientValue")
          baz
        }
      }
    `);
  });

});
