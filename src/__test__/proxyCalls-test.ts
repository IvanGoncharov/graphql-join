import { testJoin } from './testUtils';

describe('proxy calls', () => {

  test('pass random JSON as argument', async () => {
    const execute = testJoin({
      test: `
        scalar JSON
        type Query { foo(json: JSON): String }
      `,
    }, `
      type Query {
        foo(json: JSON): String @resolveWith(query: "foo")
      }
      query foo($json: JSON) @send(to: "test") {
        foo(json: $json)
      }
    `);
    await execute(`
      {
        string: foo(json: "testString")
        number: foo(json: 3.14)
        boolean: foo(json: true)
        null: foo(json: null)
        array: foo(json: [1, 2, 3, 4, 5])
        object: foo(json: { a: 1, b: 2, c: 3 })
        arrayOfObjects: foo(json: [{ a: 1 }, { b: 2 }, { c: 3}])
      }
    `);
  });

  test('pass Input object as argument', async () => {
    const execute = testJoin({
      test: `
        input Values {
          int: Int
          float: Float
          string: String
          boolean: Boolean
          arrayOfInt: [Int]
          otherValue: Values
          arrayOfValues: [Values]
        }
        type Query { foo(values: Values): String }
      `,
    }, `
      type Query {
        foo(values: Values): String @resolveWith(query: "foo")
      }
      query foo($values: Values) @send(to: "test") {
        foo(values: $values)
      }
    `);
    await execute(`
      {
        string: foo(values: { string: "testString" })
        int: foo(values: { int: 1 })
        float: foo(values: { float: 3.14 })
        boolean: foo(values: { boolean: true })
        null: foo(values: { int: null })
        arrayOfInt: foo(values: { arrayOfInt: [1, 2, 3, 4, 5] })
        otherValue: foo(values: { otherValue: { int: 1 } })
        arrayOfValues: foo(values: {
          arrayOfValues: [{ int: 1 }, { float: 2.1}]
        })
      }
    `);
  });
});

