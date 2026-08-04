// GET  /functions/v1/device-commands
//   Header: Authorization: Bearer <device token>
//   Returns pending remote commands for this device (marks them delivered).
//
// POST /functions/v1/device-commands
//   Header: Authorization: Bearer <device token>
//   Body: { commandId, status: "completed" | "failed", result? }
//   Acknowledges one command's outcome.
//
// One file, two methods, because both operate on the same small, closed
// resource (MAX-009's remote commands — sync_now, restart_player,
// clear_obsolete_media, enter_maintenance, exit_maintenance,
// update_config) rather than being two independent concerns like
// device-manifest vs device-playback-events.

import {
  bearerToken,
  errorResponse,
  jsonResponse,
  preflightResponse,
  serviceClient,
} from '../_shared/device-api.ts';

interface AckBody {
  commandId?: string;
  status?: 'completed' | 'failed';
  result?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflightResponse();

  const token = bearerToken(req);
  if (!token) {
    return jsonResponse(
      { error: 'unauthorized', message: 'Missing device credential.' },
      401,
    );
  }

  const supabase = serviceClient();

  if (req.method === 'GET') {
    const { data, error } = await supabase.rpc('get_device_pending_commands', {
      p_token: token,
    });
    if (error) return errorResponse(error);
    return jsonResponse({
      commands: (data ?? []).map(
        (row: {
          command_id: string;
          command_type: string;
          created_at: string;
        }) => ({
          commandId: row.command_id,
          commandType: row.command_type,
          createdAt: row.created_at,
        }),
      ),
    });
  }

  if (req.method === 'POST') {
    let body: AckBody;
    try {
      body = await req.json();
    } catch {
      return jsonResponse(
        { error: 'invalid_request', message: 'Body must be JSON.' },
        400,
      );
    }
    if (!body.commandId || !body.status) {
      return jsonResponse(
        {
          error: 'invalid_request',
          message: 'commandId and status are required.',
        },
        400,
      );
    }

    const { error } = await supabase.rpc('acknowledge_device_command', {
      p_token: token,
      p_command_id: body.commandId,
      p_status: body.status,
      p_result: body.result ?? null,
    });
    if (error) return errorResponse(error);
    return jsonResponse({ acknowledged: true });
  }

  return jsonResponse(
    { error: 'invalid_request', message: 'GET or POST required.' },
    405,
  );
});
