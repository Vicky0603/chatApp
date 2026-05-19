import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TextEncoder } from 'util';
import { ChatBox } from '@/components/ChatBox';

const encoder = new TextEncoder();

function createPlainResponse(init: {
  ok?: boolean;
  status: number;
  contentType?: string;
  json?: () => Promise<unknown>;
  chunks?: string[];
}): Response {
  const chunks = init.chunks ?? [];

  return {
    ok: init.ok ?? init.status < 400,
    status: init.status,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'content-type' ? (init.contentType ?? null) : null,
    },
    json:
      init.json ??
      (async () => {
        return {};
      }),
    body: chunks.length
      ? {
          getReader() {
            let index = 0;
            return {
              async read() {
                if (index >= chunks.length) {
                  return { done: true, value: undefined };
                }

                const value = encoder.encode(chunks[index]);
                index += 1;
                return { done: false, value };
              },
            };
          },
        }
      : null,
  } as unknown as Response;
}

describe('ChatBox', () => {
  beforeEach(() => {
    Object.defineProperty(global, 'fetch', {
      writable: true,
      value: jest.fn(),
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders initialMessages', () => {
    render(
      <ChatBox
        initialMessages={[
          { id: '1', role: 'assistant', content: 'Welcome to Northwind.' },
        ]}
      />,
    );

    expect(screen.getByText('Welcome to Northwind.')).toBeInTheDocument();
  });

  it('shows an optimistic bubble before fetch resolves', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(
      () =>
        new Promise(() => {
          return undefined;
        }) as Promise<Response>,
    );

    render(<ChatBox initialMessages={[]} />);

    fireEvent.change(screen.getByLabelText('Message'), {
      target: { value: 'Tell me about housing' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText('Tell me about housing')).toBeInTheDocument();
  });

  it('rolls back the optimistic bubble on error', async () => {
    let rejectRequest: ((reason?: unknown) => void) | undefined;
    (global.fetch as jest.Mock).mockImplementation(
      () =>
        new Promise((_, reject) => {
          rejectRequest = reject;
        }) as Promise<Response>,
    );

    render(<ChatBox initialMessages={[]} />);

    fireEvent.change(screen.getByLabelText('Message'), {
      target: { value: 'Tell me about scholarships' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText('Tell me about scholarships')).toBeInTheDocument();
    rejectRequest?.(new Error('network down'));

    await waitFor(() => {
      expect(
        screen.queryByText('Tell me about scholarships'),
      ).not.toBeInTheDocument();
    });
  });

  it('streams tokens into the bot bubble and removes the cursor on done', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(createPlainResponse({ status: 201 }))
      .mockResolvedValueOnce(
        createPlainResponse({
          status: 200,
          contentType: 'text/event-stream',
          chunks: [
            'id: 0\ndata: {"token":"Northwind "}\n\n',
            'id: 1\ndata: {"token":"Housing"}\n\n',
            'data: {"done":true,"turnIndex":1}\n\n',
          ],
        }),
      );

    render(<ChatBox initialMessages={[]} />);

    fireEvent.change(screen.getByLabelText('Message'), {
      target: { value: 'Tell me about housing' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText('Northwind Housing')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText('|')).not.toBeInTheDocument();
    });
  });

  it('retries a dropped stream with Last-Event-ID', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(createPlainResponse({ status: 201 }))
      .mockResolvedValueOnce(
        createPlainResponse({
          status: 200,
          contentType: 'text/event-stream',
          chunks: ['id: 0\ndata: {"token":"Northwind "}\n\n'],
        }),
      )
      .mockResolvedValueOnce(
        createPlainResponse({
          status: 200,
          contentType: 'text/event-stream',
          chunks: [
            'id: 1\ndata: {"token":"Housing"}\n\n',
            'data: {"done":true,"turnIndex":1}\n\n',
          ],
        }),
      );

    render(<ChatBox initialMessages={[]} />);

    fireEvent.change(screen.getByLabelText('Message'), {
      target: { value: 'Tell me about housing' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText('Northwind Housing')).toBeInTheDocument();
    expect((global.fetch as jest.Mock).mock.calls[2][1].headers).toEqual(
      expect.objectContaining({
        'Last-Event-ID': '0',
      }),
    );
  });
});
