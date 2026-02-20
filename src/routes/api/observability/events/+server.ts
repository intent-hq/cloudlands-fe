import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

// This endpoint provides observability events for browser access
// It reads from the temp file that the Electron app writes to

export async function GET({ url }: RequestEvent) {
  // Parse query parameters
  const limit = parseInt(url.searchParams.get('limit') || '100');
  const _filter = url.searchParams.get('filter') || '';

  try {
    // Read from the temp file
    const tempFile = path.join(os.homedir(), '.augment', 'observability', 'events.json');

    const content = await fs.readFile(tempFile, 'utf8');
    const data = JSON.parse(content);

    // Apply limit
    const events = (data.events || []).slice(0, limit);

    return json({
      success: true,
      data: {
        events,
        totalCount: events.length,
        lastUpdated: data.lastUpdated,
        storageType: 'file',
      },
    });
  } catch (error) {
    const errnoError = error as NodeJS.ErrnoException;
    // Handle file not found
    if (errnoError.code === 'ENOENT') {
      return json({
        success: true,
        data: {
          events: [],
          totalCount: 0,
          message: 'No events file found. Make sure the Intent app is running.',
          storageType: 'none',
        },
      });
    }

    return json(
      {
        success: false,
        error: (error as Error).message,
        data: {
          events: [],
          totalCount: 0,
          storageType: 'error',
        },
      },
      { status: 500 },
    );
  }
}

// Optional: Implement POST to receive events from the Electron app
export async function POST({ request }: RequestEvent) {
  try {
    const events = await request.json();

    // Here you could store events in a database or file
    // For now, just acknowledge receipt

    return json({
      success: true,
      message: `Received ${events.length} events`,
    });
  } catch (error) {
    return json(
      {
        success: false,
        error: 'Failed to process events',
      },
      { status: 400 },
    );
  }
}
