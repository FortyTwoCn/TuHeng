export function resourceRedirect(location: string) {
  return new Response(null, {
    status: 307,
    headers: {
      Location: location,
      'Cache-Control': 'private, no-store',
      'Referrer-Policy': 'no-referrer',
    },
  });
}
