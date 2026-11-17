"""Tests for the manual local bridge; use a fake scraper, never Reddit API."""
import threading
import time
import unittest

from bridge import CollectPost, Collector, sanitize_csv


def await_done(collector, timeout=1.5):
    until = time.monotonic() + timeout
    while time.monotonic() < until:
        if not collector.status()["running"]:
            return
        time.sleep(0.015)
    raise AssertionError("Worker did not become idle")


class CollectorTests(unittest.TestCase):
    def test_manual_selection_collects_each_thread_once(self):
        calls = []

        def fake_scrape(_client, post_id, max_comments, more_requests, sort):
            calls.append((post_id, max_comments, more_requests, sort))
            return {}, [{"post_id": post_id, "comment": "I want a better way.", "score": 8}]

        collector = Collector(client_factory=lambda: object(), scraper=fake_scrape)
        collector.queue_post(CollectPost(post_id="ab12cd", max_comments=250))
        await_done(collector)
        state = collector.queue_post(CollectPost(post_id="ab12cd"))
        self.assertFalse(state["queued"])
        self.assertEqual(len(calls), 1)
        self.assertEqual(collector.status()["comments"], 1)
        self.assertEqual(collector.status()["completed"], 1)
        self.assertIn("Desired outcome", collector.latest_rows()[0]["themes"])

    def test_stop_discards_queued_posts(self):
        started = threading.Event()
        release = threading.Event()
        calls = []

        def blocking(_client, post_id, *_):
            calls.append(post_id)
            started.set()
            self.assertTrue(release.wait(1.0))
            return {}, []

        collector = Collector(client_factory=lambda: object(), scraper=blocking)
        collector.queue_post(CollectPost(post_id="abc123"))
        self.assertTrue(started.wait(1.0))
        collector.queue_post(CollectPost(post_id="def456"))
        collector.stop()
        release.set()
        await_done(collector)
        self.assertEqual(calls, ["abc123"])
        self.assertEqual(collector.status()["queued"], 0)

    def test_reset_discards_inflight_results(self):
        started = threading.Event()
        release = threading.Event()

        def blocking(_client, post_id, *_):
            started.set()
            self.assertTrue(release.wait(1.0))
            return {}, [{"post_id": post_id, "comment": "Private test data"}]

        collector = Collector(client_factory=lambda: object(), scraper=blocking)
        collector.queue_post(CollectPost(post_id="abc123"))
        self.assertTrue(started.wait(1.0))
        collector.clear()
        release.set()
        time.sleep(0.04)
        self.assertEqual(collector.status()["comments"], 0)
        self.assertEqual(collector.status()["selected"], 0)

    def test_rejects_bad_id(self):
        collector = Collector(client_factory=lambda: object(), scraper=lambda *_: ({}, []))
        with self.assertRaises(ValueError):
            collector.queue_post(CollectPost(post_id="bad/id"))

    def test_csv_formula_sanitization(self):
        self.assertEqual(sanitize_csv("=2+2"), "'=2+2")
        self.assertEqual(sanitize_csv(" +cmd"), "' +cmd")
        self.assertEqual(sanitize_csv("A normal comment"), "A normal comment")


if __name__ == "__main__":
    unittest.main()
