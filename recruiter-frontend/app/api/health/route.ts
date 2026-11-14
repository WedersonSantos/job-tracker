export function GET() {
  return Response.json({ app: "job-tracker", ready: true }, { headers: { "Cache-Control": "no-store" } });
}
