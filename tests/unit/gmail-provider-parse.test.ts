import { describe, it, expect } from 'vitest';
import { parseMessage, extractAttachments, parseAddressList } from '../../electron/gmail/gmail-provider';

describe('gmail provider parsing (pure)', () => {
  it('parseMessage pulls headers, labels, flags, and participants', () => {
    const raw = {
      id: 'm1',
      threadId: 't1',
      historyId: '555',
      internalDate: '1700000000000',
      snippet: 'hello there',
      sizeEstimate: 4096,
      labelIds: ['INBOX', 'UNREAD', 'IMPORTANT'],
      payload: {
        headers: [
          { name: 'From', value: 'Amazon <ship@amazon.com>' },
          { name: 'To', value: 'me@example.com' },
          { name: 'Cc', value: 'Bob <bob@x.com>, carol@y.com' },
          { name: 'Subject', value: 'Your package has shipped' },
          { name: 'Date', value: 'Mon, 14 Jul 2026 10:00:00 +0000' },
        ],
      },
    };
    const { message, participants } = parseMessage(raw);
    expect(message.id).toBe('m1');
    expect(message.threadId).toBe('t1');
    expect(message.historyId).toBe('555');
    expect(message.internalDate).toBe(1_700_000_000_000);
    expect(message.subject).toBe('Your package has shipped');
    expect(message.snippet).toBe('hello there');
    expect(message.sizeEstimate).toBe(4096);
    expect(message.isUnread).toBe(true);
    expect(message.isStarred).toBe(false);
    expect(message.fromName).toBe('Amazon');
    expect(message.fromAddress).toBe('ship@amazon.com');

    // from + to + 2 cc = 4 participants
    expect(participants).toHaveLength(4);
    expect(participants.find((p) => p.role === 'from')?.address).toBe('ship@amazon.com');
    expect(participants.filter((p) => p.role === 'cc').map((p) => p.address)).toEqual(['bob@x.com', 'carol@y.com']);
  });

  it('starred/unread flags derive from labels', () => {
    const { message } = parseMessage({ id: 'm', threadId: 't', labelIds: ['STARRED'], payload: { headers: [] } });
    expect(message.isStarred).toBe(true);
    expect(message.isUnread).toBe(false);
  });

  it('parseAddressList handles name<addr>, bare addr, and empty', () => {
    expect(parseAddressList('Jane Doe <jane@x.com>', 'to')).toEqual([{ name: 'Jane Doe', address: 'jane@x.com', role: 'to' }]);
    expect(parseAddressList('plain@x.com', 'from')).toEqual([{ name: null, address: 'plain@x.com', role: 'from' }]);
    expect(parseAddressList('a@x.com, b@y.com', 'cc')).toHaveLength(2);
    expect(parseAddressList(undefined, 'to')).toEqual([]);
    expect(parseAddressList('', 'to')).toEqual([]);
  });

  it('extractAttachments walks the MIME tree (full format only)', () => {
    const payload = {
      mimeType: 'multipart/mixed',
      parts: [
        { mimeType: 'text/plain', body: { size: 10 } }, // no filename → not an attachment
        { filename: 'invoice.pdf', mimeType: 'application/pdf', body: { attachmentId: 'att1', size: 20480 } },
        {
          mimeType: 'multipart/alternative',
          parts: [{ filename: 'photo.png', mimeType: 'image/png', body: { attachmentId: 'att2', size: 5120 } }],
        },
      ],
    };
    const atts = extractAttachments(payload);
    expect(atts).toHaveLength(2);
    expect(atts.map((a) => a.filename)).toEqual(['invoice.pdf', 'photo.png']);
    expect(atts[0]).toMatchObject({ attachmentId: 'att1', mimeType: 'application/pdf', sizeBytes: 20480, localPath: null });
  });

  it('metadata-format payload (no parts) yields zero attachments', () => {
    expect(extractAttachments({ headers: [] })).toEqual([]);
    expect(extractAttachments(undefined)).toEqual([]);
  });
});
