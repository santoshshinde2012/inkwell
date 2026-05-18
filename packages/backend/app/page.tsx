// Minimal landing page. The extension is the user-facing surface; this page
// just confirms the backend is up and points to the health check.

export default function Home(): JSX.Element {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Inkwell</h1>
      <p className="text-zinc-600">
        This is the backend for the Inkwell Chrome extension. Install the
        extension to use the product — there is no account or sign-in.
      </p>
      <ul className="text-sm text-zinc-500">
        <li>
          Health check:{" "}
          <a href="/api/v1/health" className="underline">
            /api/v1/health
          </a>
        </li>
        <li>
          See <code className="rounded bg-zinc-100 px-1 py-0.5">README.md</code>{" "}
          for setup instructions.
        </li>
      </ul>
    </main>
  );
}
