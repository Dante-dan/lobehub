import { describe, expect, it, vi } from 'vitest';

import { createCallbacksTransformer } from './protocol';

describe('createCallbacksTransformer literal SSE markers', () => {
  it.each(['text', 'reasoning'] as const)(
    'preserves embedded data: markers in %s callbacks and final output',
    async (type) => {
      const onCompletion = vi.fn();
      const onFinal = vi.fn();
      const onText = vi.fn();
      const onThinking = vi.fn();
      const chunks = [
        'Before ',
        '```yaml\ndata: value\n```',
        '```js\nconst marker = "data:";\n// data: example\n```',
        ' after',
      ];
      const input = chunks.flatMap((chunk) => [
        `event: ${type}\n`,
        `data: ${JSON.stringify(chunk)}\n\n`,
      ]);
      const output: Uint8Array[] = [];
      const source = new ReadableStream<string>({
        start(controller) {
          input.forEach((chunk) => controller.enqueue(chunk));
          controller.close();
        },
      });

      await source
        .pipeThrough(createCallbacksTransformer({ onCompletion, onFinal, onText, onThinking }))
        .pipeTo(
          new WritableStream({
            write: (chunk) => {
              output.push(chunk);
            },
          }),
        );

      const callback = type === 'text' ? onText : onThinking;
      expect(callback.mock.calls.map(([chunk]) => chunk)).toEqual(chunks);
      expect(onCompletion).toHaveBeenCalledWith(
        expect.objectContaining(
          type === 'text'
            ? { text: chunks.join('') }
            : {
                reasoning: expect.objectContaining({ content: chunks.join('') }),
                thinking: chunks.join(''),
              },
        ),
      );
      expect(onFinal).toHaveBeenCalledWith(onCompletion.mock.calls[0][0]);
      expect(new TextDecoder().decode(Buffer.concat(output))).toBe(input.join(''));
    },
  );
});
