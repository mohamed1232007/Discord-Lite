import { BACKEND_URL } from './backendUrl';

export const callApi = async (token, path, { body, ...options } = {}) => {
  const response = await fetch(`${BACKEND_URL}/calls${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...options.headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error('The call service returned an invalid response.');
  }
  if (!response.ok) throw new Error(data.error || 'The call request failed.');
  return data;
};
