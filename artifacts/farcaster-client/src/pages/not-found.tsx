import { AlertCircle } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="glass rounded-2xl p-8 max-w-sm w-full text-center space-y-4">
        <AlertCircle className="w-12 h-12 text-destructive mx-auto" />
        <h1 className="text-2xl font-bold gradient-text">404</h1>
        <p className="text-muted-foreground text-sm">Page not found</p>
        <a
          href="/"
          className="inline-block px-5 py-2.5 rounded-xl text-sm font-semibold text-primary-foreground btn-luxury"
        >
          Back to home
        </a>
      </div>
    </div>
  );
}
