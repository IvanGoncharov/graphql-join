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
         bar: String @resolveWith(query: "bar", argumentsFragment: "FooArg")
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
});
