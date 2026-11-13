/**
 * Design jobs run on the server independently of the browser connection: a phone that switches apps
 * drops the connection, but the job keeps going and the page picks up where it was when it comes back.
 */
type Job = { events: object[]; done: boolean; listeners: Set<() => void>; finished: number };
const jobs = new Map<string, Job>();

export function createJob(id: string) {
	const job: Job = { events: [], done: false, listeners: new Set(), finished: 0 };
	jobs.set(id, job);
	// forget finished jobs after an hour
	for (const [k, j] of jobs) if (j.done && Date.now() - j.finished > 3600_000) jobs.delete(k);
	return {
		send(o: object) {
			job.events.push(o);
			for (const l of job.listeners) l();
		},
		finish() {
			job.done = true;
			job.finished = Date.now();
			for (const l of job.listeners) l();
		}
	};
}

/** Server-sent events for a job, starting at event number `from`. */
export function streamJob(id: string, from = 0): Response | null {
	const job = jobs.get(id);
	if (!job) return null;
	const enc = new TextEncoder();
	let pos = Math.max(0, from);
	let listener: (() => void) | null = null;
	const stream = new ReadableStream({
		start(ctrl) {
			const flush = () => {
				try {
					while (pos < job.events.length) {
						const ev = { ...job.events[pos], n: pos + 1 };
						ctrl.enqueue(enc.encode('data: ' + JSON.stringify(ev) + '\n\n'));
						pos++;
					}
					if (job.done) {
						job.listeners.delete(listener!);
						ctrl.close();
					}
				} catch {
					job.listeners.delete(listener!);
				}
			};
			listener = flush;
			job.listeners.add(flush);
			ctrl.enqueue(enc.encode('data: ' + JSON.stringify({ type: 'job', id }) + '\n\n'));
			flush();
		},
		cancel() {
			if (listener) job.listeners.delete(listener);
		}
	});
	return new Response(stream, {
		headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'x-accel-buffering': 'no' }
	});
}
