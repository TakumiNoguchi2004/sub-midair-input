# Mid-Air Flick & Drawing Input
## Presentation Script (≈3 min 20 sec + Demo TBD)

---

# Time Summary

Current estimated total, without the unfinished demo, is about 3 minutes and 20 seconds.

Breakdown:
- Slide 1: about 10 seconds
- Slide 2: about 50 seconds
- Slide 3: about 35 seconds
- Slide 4: about 30 seconds
- Slide 5: Demo TBD
- Slide 6: about 40 seconds
- Slide 7: about 25 seconds
- Slide 8: about 10 seconds

---

# Slide 1 - Title (≈10 sec)

Good afternoon, everyone.

We are Group 3.
Today, we will present **Mid-Air Flick & Drawing Input**.

---

# Slide 2 - Background (≈50 sec)

Let's start with the motivation.

Keyboards and voice input are common.
But they are not always useful.

For example, keyboards are hard to use when your hands are dirty or when you are wearing gloves.
Voice input is also hard to use in noisy places.
It is also not good in quiet places, such as libraries.

So, we made a contactless input method using hand gestures.

We wanted the system to be:
- Contactless
- Silent
- One-handed
- Easy to learn
- Able to input Japanese, English, and emojis

---

# Slide 3 - System Overview (≈35 sec)

This is the overall system.

In this system, we capture hand motion with MediaPipe and use it as input.

The system has three input methods: Japanese, English, and emoji.
Language switching is also controlled from the camera input.

For emoji input, we search a vector database built with CLIP.

---

# Slide 4 - Input Methods (≈30 sec)

Here are the input methods.

Japanese and English use flick gestures.
They are similar to smartphone keyboards, so they are easy to learn.

For emojis, users draw a picture in the air.
They do not need to remember special gestures.

This makes emoji search more natural.

---

# Slide 5 - Demo (TBD)

Now we will show a demo of our system.

Demo script will be added later.

---

# Slide 6 - Evaluation (≈40 sec)

Next, let's look at the evaluation.

We compared our system with keyboard and voice input.

Our system is slower and less accurate than them.
But the result shows that text input with only hand gestures is possible.

For emoji search, ViT-L/14 had the best Top-1 recall.
ViT-B/32 was the fastest model.

---

# Slide 7 - Conclusion & Future Work (≈25 sec)

To conclude, we developed a contactless, silent, one-handed input system.
It supports Japanese, English, and emojis.

However, the speed and accuracy still need to be improved.

In the future, we will improve finger assignment, especially for English input.
We will also improve the recognition algorithm.

---

# Slide 8 - Thank You (≈10 sec)

Thank you very much for your attention.

We'd be happy to answer any questions.
