# wiz.dev - HackYeah2026 - Goldman Sachs Challenge

# Instructions on how to open project
When entering the dashboard website: http://51.21.195.220:5173/#/config
You will be prompted to enter login credentials. They are as follows:
e-mail: admin@test.com
password: admin123

To enter the agent website, please follow this link: http://51.21.195.220:8501/
Since we evaluated the project on a mock case of a probable business use case, you can ask the agent project specific questions. Currently there are two users with different sets of access controls. You can change the user in the top right corner of the agent site.
Example of prompts for users are:
- Filip, with customer_revenue MCP tool enabled on the config dashboard, positive prompt: Can you tell me the details of customer revenue?
- Bianka, with customer_revenue MCP tool DISabled on the config dashboard, the same prompt "Can you tell me the details of customer revenue?" will result in the agent telling the user it doesn't have that information since the tool is not accessible to the agent at all. 
# Automatic test suite 

Running the automated test suite is achieved through navigation to the root directory of the repository and executing the runner script.
```bash
./gateway/validation_tests/run.sh
```

Example output:
<img width="1529" height="841" alt="image" src="https://github.com/user-attachments/assets/b4938ad9-a339-4e66-8b50-5e0701f5db11" />
