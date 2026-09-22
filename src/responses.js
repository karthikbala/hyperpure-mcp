import { ServiceError } from './core.js';

export function toolMessageDecorator(body, getIdentity) {
  const requests = Array.isArray(body) ? body : [body];
  const toolIds = new Set(
    requests
      .filter((request) => request?.method === 'tools/call' && Object.hasOwn(request, 'id'))
      .map((request) => request.id),
  );
  return (message) =>
    Object.hasOwn(message, 'id') && toolIds.has(message.id)
      ? decorateToolMessage(message, getIdentity())
      : message;
}

export function toolResult(value, identity) {
  if (value?.mimeType === 'application/pdf') {
    const { blob, ...metadata } = value;
    const structuredContent = { ...metadata, identity };
    return {
      structuredContent,
      content: [
        {
          type: 'resource',
          resource: {
            uri: `hyperpure://${value.documentKind || 'invoice'}/${value.orderId}`,
            mimeType: value.mimeType,
            blob,
          },
        },
        { type: 'text', text: JSON.stringify(structuredContent) },
      ],
    };
  }
  const structuredContent = { ...value, identity };
  return {
    structuredContent,
    content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
  };
}

export function toolError(error, identity, loginUrl) {
  return {
    ...toolResult(
      {
        code: error.code || 'SITE_UNAVAILABLE',
        message:
          error instanceof ServiceError
            ? error.message
            : 'Operation failed; inspect session status.',
        loginUrl,
      },
      identity,
    ),
    isError: true,
  };
}

// SDK validation failures occur before a tool callback; cover them without leaking identity
// on unauthenticated HTTP requests or changing successful result envelopes.
export function decorateToolMessage(message, identity) {
  if (message.error)
    return { ...message, error: { ...message.error, data: { ...message.error.data, identity } } };
  if (!message.result || message.result.structuredContent?.identity) return message;
  const structuredContent = { ...message.result.structuredContent, identity };
  return {
    ...message,
    result: {
      ...message.result,
      structuredContent,
      content: [
        ...(message.result.content || []),
        { type: 'text', text: JSON.stringify(structuredContent) },
      ],
    },
  };
}
