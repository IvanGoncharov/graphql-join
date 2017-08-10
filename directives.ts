import { buildSchema } from 'graphql';

export const exportDirective = buildDirective(`
  directive @export(as: String!) on FIELD
`)

export const resolveWithDirective = buildDirective(`
  directive @resolveWith(
    query: String!,
    argumentsFragment: String
  ) on FIELD_DEFINITION
`)

function buildDirective(IDL: string) {
  const dummyIDL = `
    type Query {
      dummy: String
    }
  `;

  const schema = buildSchema(dummyIDL + IDL);
  return schema.getDirectives()[0];
}
