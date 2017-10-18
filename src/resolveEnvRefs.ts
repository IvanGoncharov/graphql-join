import { cloneDeepWith } from 'lodash';

export default function resolveEnvRefs<T extends any>(config: T): T {
  return cloneDeepWith<any>(config, value => {
    if (typeof value !== 'string') {
      return;
    }

    let result = value;
    const regex = /\${([^}]*)}/g;
    let match
    // tslint:disable-next-line:no-conditional-assignment
    while ((match = regex.exec(value)) !== null) {
      if (match.index > 0 && value[match.index - 1] === '\\') {
        continue;
      }
      const rawRef = match[1];
      const [type, ref] = rawRef.split(/\s*:\s*/);
      if (type !== 'env') {
        throw new Error(
          `Undefined reference type ${type}. Only "\${env:NAME}" is supported`
        );
      }
      if (!ref) {
        throw new Error(`Missing name of enviroment value: ${rawRef}`);
      }

      const refValue = process.env[ref];
      if (!refValue) {
        throw new Error(`Environment variable ${ref} is not set`);
      }
      result = result.replace(match[0], refValue);
    }
    return result;
  });
}
