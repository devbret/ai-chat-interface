# AI Chat Interface

![Screenshot of the AI chat interface.](https://hosting.photobucket.com/bbcfb0d4-be20-44a0-94dc-65bff8947cf2/3b25b173-42e4-4eb7-aad5-c0ca7f97dd43.png)

A Flask-based web app which provides an interactive browser interface for chatting with an Ollama-hosted LLM while also enabling users to upload text files for AI-powered analysis, summarization and synthesis.

## Overview

In chat mode, users can send normal prompts through a browser UI, optionally include a system prompt, choose streaming or non-streaming responses, and adjust generation settings such as temperature, max predicted tokens and context window size. The backend forwards those requests to the Ollama `/api/chat` endpoint, then returns either a standard JSON response or a server-sent events stream so replies can appear progressively in the interface as they are generated.

The application also supports `.txt` file analysis for larger documents. When a user uploads a text file, the app reads and validates it, splits long content into manageable chunks, summarizes each chunk with the model and then synthesizes those chunk summaries into a final structured overview. For smaller files, it can analyze the entire document directly in one pass. Meaning the app can be used both as a general-purpose local AI chat client and as a document analysis tool that extracts key ideas, themes, entities, dates and other insights from uploaded text.
