export const definition = {
  name: 'scan_errors',
  description: 'Scan application logs for errors (secondary)',
  inputSchema: {
    type: 'object',
    properties: {
      logGroupPrefix: { type: 'string' },
      hoursBack: { type: 'number' },
      filterPattern: { type: 'string' },
    },
    required: ['logGroupPrefix', 'hoursBack'],
  },
};

export async function execute(args) {
  return { status: 'stub', message: 'Use sre_run_pipeline for primary workflow', args };
}
