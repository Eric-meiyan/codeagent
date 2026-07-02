export function respData(data: any) {
  return respJson(0, 'ok', data || []);
}

export function respOk() {
  return respJson(0, 'ok');
}

export function respErr(message: string) {
  return respJson(-1, message);
}

export function respPage(items: any[], total: number) {
  return respJson(0, 'ok', { items, total });
}

export function respJson(code: number, message: string, data?: any) {
  let json: Record<string, any> = {
    code: code,
    message: message,
  };
  if (data) {
    json['data'] = data;
  }
  return Response.json(json);
}
