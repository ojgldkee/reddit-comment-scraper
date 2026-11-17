import unittest

from reddit_core import add_labels, classify_comment, markdown_report, thread_ids_from_text


class RedditCoreTests(unittest.TestCase):
    def test_multiple_links_and_duplicates(self):
        urls = (
            "https://www.reddit.com/r/fitness/comments/ab12cd/title/\n"
            "https://redd.it/ef34gh?share_id=1\n"
            "https://old.reddit.com/r/fitness/comments/ab12cd/duplicate/\n"
            "https://example.com/r/no/comments/x123/"
        )
        self.assertEqual(thread_ids_from_text(urls), ["ab12cd", "ef34gh"])

    def test_invalid_and_non_post_links(self):
        self.assertEqual(
            thread_ids_from_text("https://reddit.com/r/news https://evilreddit.com/comments/foo"),
            [],
        )

    def test_theme_labels_can_overlap(self):
        labels = classify_comment("I am frustrated. I tried everything and want a better way.")
        self.assertIn("Pain and frustration", labels)
        self.assertIn("Desired outcome", labels)
        self.assertIn("Past solutions and workarounds", labels)

    def test_unknown_language_not_misclassified(self):
        self.assertEqual(classify_comment("The blue cup is on the shelf."), [])

    def test_export_summary(self):
        rows = [{
            "post_id": "abc123",
            "post_title": "A discussion",
            "comment": "I wish this was cheaper.",
            "comment_url": "https://www.reddit.com/r/test/comments/abc123/comment/xyz",
            "score": 10,
        }]
        labeled = add_labels(rows)
        self.assertEqual(len(labeled), 1)
        self.assertIn("Desired outcome", labeled[0]["themes"])
        report = markdown_report(labeled)
        self.assertIn("Unique posts: 1", report)
        self.assertIn("https://www.reddit.com", report)


if __name__ == "__main__":
    unittest.main()
