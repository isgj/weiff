package repo

import "bytes"

type boundedBuffer struct {
	buffer    bytes.Buffer
	limit     int
	truncated bool
}

func (b *boundedBuffer) Write(data []byte) (int, error) {
	written := len(data)
	if b.limit <= 0 {
		_, err := b.buffer.Write(data)
		return written, err
	}

	remaining := b.limit - b.buffer.Len()
	if remaining <= 0 {
		b.truncated = b.truncated || written > 0
		return written, nil
	}
	if len(data) > remaining {
		data = data[:remaining]
		b.truncated = true
	}
	_, err := b.buffer.Write(data)
	return written, err
}

func (b *boundedBuffer) Bytes() []byte {
	return b.buffer.Bytes()
}

func (b *boundedBuffer) Truncated() bool {
	return b.truncated
}
