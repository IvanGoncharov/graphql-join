import { testJoin } from './testUtils';

describe('joinSchema', () => {

  test('Preserve type description', async () => {
    const execute = testJoin(
      {
        test1: `
          # Foo description
          type Foo { value: String }
          type Query { foo: Foo }
        `,
        test2: `
          # Bar description
          type Bar { value: String }
          type Query { bar: Bar }
        `,
      }, `
        type Query {
          proxyFoo: Foo @resolveWith(query: "foo1")
          proxyBar: Bar @resolveWith(query: "foo2")
        }
        query foo1 @send(to: "test1") {
          foo {
            ...CLIENT_SELECTION
          }
        }
        query foo2 @send(to: "test2") {
          bar {
            ...CLIENT_SELECTION
          }
        }
      `
    );

    await execute(`
      {
        fooDescription: __type(name: "Foo") { description }
        barDescription: __type(name: "Bar") { description }
      }
    `);
  });

  test('Proxy only types referenced inside join schema', async () => {
    const execute = testJoin(
      {
        test: `
          type TypeToIgnore { stub: String, stubSubtype: SubTypeToIgnore }
          type SubTypeToIgnore { baz: String }
          type TypeToProxy { foo: String, bar: SubTypeToProxy }
          type SubTypeToProxy { baz: String }
          type Query {
            typeToIgnore: TypeToIgnore
            typeToProxy: TypeToProxy
          }
        `,
      }, `
        type Query {
          typeToProxy: TypeToProxy @resolveWith(query: "typeToProxy")
        }
        query typeToProxy @send(to: "test") {
          typeToProxy {
            ...CLIENT_SELECTION
          }
        }
      `);

    await execute(`
      {
        typeToProxy {
          foo
          bar {
            baz
          }
        }
      }
    `);
  });

  test('Prefix remote types', async () => {
    const execute = testJoin(
      {
        test: {
          idl: `
            type Query { foo: BarOrBaz }
            union BarOrBaz = Bar | Baz
            type Bar { bar: String }
            type Baz { baz: String }
          `,
          prefix: 'PrEfIx_'
        },
      },
      'schema { query: PrEfIx_Query }'
    );

    await execute({
      query: `{
        foo {
          ... on PrEfIx_Bar { bar }
          ... on PrEfIx_Baz { baz }
        }
      }`,
      rootValues: { test: {
        foo: { __typename: 'Baz' }
      }}
    });
  });

  test('Merge duplicate types', async () => {
    const execute = testJoin(
      {
        test1: `
          type Foo { foo: String }
          type Query { foo: Foo }
        `,
        test2: `
          type Foo { foo: String }
          type Query { foo: Foo }
        `,
      }, `
        type Query {
          proxyFoo1: Foo @resolveWith(query: "foo1")
          proxyFoo2: Foo @resolveWith(query: "foo2")
        }
        query foo1 @send(to: "test1") {
          foo {
            ...CLIENT_SELECTION
          }
        }
        query foo2 @send(to: "test2") {
          foo {
            ...CLIENT_SELECTION
          }
        }
      `
    );

    await execute(`
      {
        proxyFoo1 { foo }
        proxyFoo2 { foo }
      }
    `);
  });

  test('Merge duplicate abstract types', async () => {
    const idl = `
      type Query { foo: BarOrBaz }
      union BarOrBaz = Bar | Baz
      type Bar { bar: String }
      type Baz { baz: String }
    `;
    const execute = testJoin(
      {
        test1: idl,
        test2: idl,
      }, `
        type Query {
          proxyFoo1: BarOrBaz @resolveWith(query: "foo1")
          proxyFoo2: BarOrBaz @resolveWith(query: "foo2")
        }
        query foo1 @send(to: "test1") {
          foo {
            ...CLIENT_SELECTION
          }
        }
        query foo2 @send(to: "test2") {
          foo {
            ...CLIENT_SELECTION
          }
        }
      `
    );

    await execute({
      query: `
        query {
          proxyFoo1 { ... on Bar { bar } }
          proxyFoo2 { ... on Baz { baz } }
        }
      `,
      rootValues: {
        test1: {
          foo: { __typename: 'Bar' }
        },
        test2: {
          foo: { __typename: 'Baz' }
        },
      }
    });
  });

});
