# AI Chat Interface

![Screenshot of the AI chat interface.](https://hosting.photobucket.com/bbcfb0d4-be20-44a0-94dc-65bff8947cf2/6fd81002-2be0-42c1-b253-1e5a4db7aa0d.png)

Local Flask-based AI chat interface for Ollama-hosted language models, featuring conversations, real-time streaming responses and `.txt` file upload support for analysis.

## Overview

In chat mode, users can send normal prompts through a browser UI, optionally include a system prompt, choose streaming or non-streaming responses, and adjust generation settings such as temperature, max predicted tokens and context window size. The backend forwards those requests to the Ollama `/api/chat` endpoint, then returns either a standard JSON response or a server-sent events stream so replies can appear progressively in the interface as they are generated.

The application also supports `.txt` file analysis for larger documents. When a user uploads a text file, the app reads and validates it, splits long content into manageable chunks, summarizes each chunk with the model and then synthesizes those chunk summaries into a final structured overview. For smaller files, it can analyze the entire document directly in one pass. Meaning the app can be used both as a general-purpose local AI chat client and as a document analysis tool that extracts key ideas, themes, entities, dates and other insights from uploaded text.

## Set Up

Below are instructions for installing and running this application on a Linux machine.

### Programs Needed

- [Git](https://git-scm.com/downloads)

- [Python](https://www.python.org/downloads/)

### Steps

1. Install the above programs

2. Open a terminal

3. Clone this repository: `git clone git@github.com:devbret/ai-chat-interface.git`

4. Navigate to the repo's directory: `cd ai-chat-interface`

5. Create a virtual environment: `python3 -m venv venv`

6. Activate your virtual environment: `source venv/bin/activate`

7. Install the needed Python dependencies: `pip install -r requirements.txt`

8. Convert the `.env.template` file into a `.env` file: `cp .env.template .env`

9. Add values for environmental variables to the `.env` file: `nano .env`

10. Ensure Ollama is installed and available: `ollama --version`

11. Launch Ollama and your local LLM

12. Open the AI chat interface: `python3 app.py`

13. Visit the AI chat interface in your browser: `http://localhost:8000`

14. Stop the Flask app when finished chatting by pressing: `Ctrl + C`

15. Exit the virtual environment: `deactivate`

## Other Considerations

This project repo is intended to demonstrate an ability to do the following:

- Provide a local web-based chat interface for interacting with Ollama-powered AI models

- Support both standard responses and streaming responses, enabling users to choose how AI output appears

- Allow users to upload `.txt` files, analyze their contents and generate summaries or structured responses

- Let users configure model behavior through options such as temperature, context length and response length

If you have any questions or would like to collaborate, please reach out either on GitHub or via [my website](https://bretbernhoft.com/).
