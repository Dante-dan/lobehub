import { describe, expect, it, vi } from 'vitest';

import { OpenAIStream } from './openai';

describe('OpenAIStream literal thinking tags', () => {
  it.each([
    ['Here is `<think>` in inline code.'],
    ['```html\n', '<think>', '\n</think>\n```\nThe end.'],
    ['The tag is ', '<think>', ' and this remains the answer.'],
    ['<think>Reasoning</think>', 'The literal tag is ', '<think>', '.'],
  ])('preserves answer content without re-entering reasoning: %j', async (...deltas) => {
    const onText = vi.fn();
    const onThinking = vi.fn();
    const onCompletion = vi.fn();
    const source = new ReadableStream({
      start(controller) {
        deltas.forEach((content) =>
          controller.enqueue({
            choices: [{ delta: { content }, index: 0 }],
            id: 'literal-think',
          }),
        );
        controller.close();
      },
    });

    await OpenAIStream(source, { callbacks: { onCompletion, onText, onThinking } }).pipeTo(
      new WritableStream({ write() {} }),
    );

    const hasReasoning = deltas[0].startsWith('<think>Reasoning');
    const answer = (hasReasoning ? deltas.slice(1) : deltas).join('');
    expect(onText.mock.calls.map(([text]) => text).join('')).toBe(answer);
    expect(onThinking.mock.calls.map(([text]) => text).join('')).toBe(
      hasReasoning ? 'Reasoning' : '',
    );
    expect(onCompletion).toHaveBeenCalledWith(expect.objectContaining({ text: answer }));
  });
});
