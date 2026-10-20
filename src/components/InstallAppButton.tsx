import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type PromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<unknown> };

export function InstallAppButton({ className = "" }: { className?: string }) {
  const [deferred, setDeferred] = useState<PromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [open, setOpen] = useState(false);
  const [ios, setIos] = useState(false);
  const [framed, setFramed] = useState(false);

  useEffect(() => {
    try {
      setFramed(window.self !== window.top);
    } catch {
      setFramed(true);
    }
    try {
      setFramed(window.self !== window.top);
    } catch {
      setFramed(true);
    }
    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent));
    setInstalled(window.matchMedia("(display-mode: standalone)").matches);
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as PromptEvent);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed) return null;

  const onClick = async () => {
    if (deferred && !framed) {
      await deferred.prompt();
      setDeferred(null);
      return;
    }
    setOpen(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        className={
          "inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground " +
          className
        }
      >
        <Download className="h-4 w-4" aria-hidden="true" />
        Get the app
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Put Plexecute on your phone</DialogTitle>
            <DialogDescription>
              It opens full screen from its own icon, just like an app.
            </DialogDescription>
          </DialogHeader>
          {framed ? (
            <p className="text-sm text-muted-foreground">
              Installing only works on the live site. Open plexecute.io in your phone's browser,
              then tap "Get the app" again.
            </p>
          ) : ios ? (
            <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
              <li>Open this page in Safari.</li>
              <li>Tap the Share button at the bottom of the screen.</li>
              <li>Choose "Add to Home Screen", then tap Add.</li>
            </ol>
          ) : (
            <div className="space-y-4 text-sm text-muted-foreground">
              <div>
                <p className="font-medium text-foreground">iPhone</p>
                <p>In Safari, tap Share, then "Add to Home Screen".</p>
              </div>
              <div>
                <p className="font-medium text-foreground">Android</p>
                <p>
                  In Chrome, tap the menu (three dots), then "Install app" or "Add to Home screen".
                </p>
              </div>
              <div>
                <p className="font-medium text-foreground">Computer</p>
                <p>In Chrome or Edge, click the install icon at the right of the address bar.</p>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
