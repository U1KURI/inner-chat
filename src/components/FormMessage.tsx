export function FormMessage({ error, notice }: { error?: string; notice?: string }) {
  if (error) {
    return (
      <p className="msg error" role="alert">
        {error}
      </p>
    );
  }
  if (notice) {
    return (
      <p className="msg notice" role="status">
        {notice}
      </p>
    );
  }
  return null;
}
