import { Card, CardContent } from "@/sjsu/components/ui/card";

/**
 * Sign-off is not built. There is no reviewer identity, no approval, and no human score to
 * compare a model score against — so this screen says that instead of showing a queue that
 * nothing can be done with.
 */
export function ReviewsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reviews</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Reviewer sign-off is not built.
        </p>
      </div>

      <Card size="sm">
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            Every score in this app is a model score, and none of them has been signed off.
            Nobody can approve, reject, or adjust one here yet.
          </p>
          <p>
            There is also nothing to compare them against: no human scores are stored, so the
            app shows no agreement rate, no variance, and no review queue.
          </p>
          <p>
            The scores themselves are on the scholarships screen, marked unreviewed.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
