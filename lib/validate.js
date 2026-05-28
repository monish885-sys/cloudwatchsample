import Ajv from 'ajv';

const ajv = new Ajv({ allErrors: true, strict: false });

export function validateAgainstSchema(data, schema) {
  const validate = ajv.compile(schema);
  const ok = validate(data);
  if (!ok) {
    return { valid: false, errors: validate.errors };
  }
  return { valid: true, errors: [] };
}

export function assertValidArgs(data, schema) {
  const result = validateAgainstSchema(data, schema);
  if (!result.valid) {
    const msg = result.errors?.map((e) => `${e.instancePath} ${e.message}`).join('; ') || 'validation failed';
    throw new Error(`Invalid arguments: ${msg}`);
  }
}
