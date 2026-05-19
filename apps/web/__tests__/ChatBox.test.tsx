import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ChatBox } from '@/components/ChatBox';

const encoder = new TextEncoder();

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
      .mockResolvedValueOnce(new Response(null, { status: 201 }))
      .mockResolvedValueOnce(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                encoder.encode('id: 0\ndata: {"token":"Northwind "}\n\n'),
              );
              controller.enqueue(
                encoder.encode('id: 1\ndata: {"token":"Housing"}\n\n'),
              );
              controller.enqueue(
                encoder.encode('data: {"done":true,"turnIndex":1}\n\n'),
              );
              controller.close();
            },
          }),
          {
            status: 200,
            headers: { 'content-type': 'text/event-stream' },
          },
        ),
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
      .mockResolvedValueOnce(new Response(null, { status: 201 }))
      .mockResolvedValueOnce(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                encoder.encode('id: 0\ndata: {"token":"Northwind "}\n\n'),
              );
              controller.close();
            },
          }),
          {
            status: 200,
            headers: { 'content-type': 'text/event-stream' },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                encoder.encode('id: 1\ndata: {"token":"Housing"}\n\n'),
              );
              controller.enqueue(
                encoder.encode('data: {"done":true,"turnIndex":1}\n\n'),
              );
              controller.close();
            },
          }),
          {
            status: 200,
            headers: { 'content-type': 'text/event-stream' },
          },
        ),
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
